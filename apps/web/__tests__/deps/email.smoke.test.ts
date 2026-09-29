import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMailMock = vi.fn().mockResolvedValue({ messageId: "test-id" });
const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: createTransportMock,
  },
}));

describe("email (nodemailer v9)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.SMTP_HOST = "smtp.test.local";
    process.env.SMTP_USER = "user@test.local";
    process.env.SMTP_PASSWORD = "secret";
    process.env.SMTP_PORT = "587";
    process.env.SMTP_SECURE = "false";
    process.env.NEXTAUTH_URL = "https://gavel.test";
  });

  it("sendMail ruft transporter.sendMail genau einmal auf", async () => {
    const { sendMail } = await import("@/lib/email");
    await sendMail({
      to: "test@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.test.local",
        port: 587,
      }),
    );
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock.mock.calls[0][0].subject).toBe("Test");
  });

  it("sendAlertEmail enthält Alert-Namen im Betreff", async () => {
    const { sendAlertEmail } = await import("@/lib/email");
    await sendAlertEmail({
      to: "user@test.local",
      userName: "Test",
      alertName: "NRW unter 200k",
      listings: [
        {
          typ: "Wohnung",
          adresse: "Musterstr. 1",
          verkehrswert: 150000,
          slug: "test-slug",
          bundesland: "nrw",
        },
      ],
    });

    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.subject).toContain("NRW unter 200k");
    expect(payload.html).toContain("https://gavel.test/nordrhein-westfalen/test-slug");
    expect(payload.html).toContain("150.000");
    expect(payload.text).toContain("https://gavel.test/nordrhein-westfalen/test-slug");
  });

  it("sendAlertEmail zeigt keinen 0-€-Verkehrswert bei fehlendem Wert", async () => {
    const { sendAlertEmail } = await import("@/lib/email");
    await sendAlertEmail({
      to: "user@test.local",
      userName: "Test",
      alertName: "Ohne Verkehrswert",
      listings: [
        {
          typ: "Wohnung",
          adresse: "Musterstr. 1",
          verkehrswert: null,
          slug: "ohne-vw",
          bundesland: "nrw",
        },
      ],
    });

    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).toContain("Verkehrswert nicht bekannt");
    expect(html).not.toContain("0 €");
    expect(html).not.toContain("0 €");
  });

  it("übernimmt hrefs in den Plain-Text-Teil", async () => {
    const { htmlToPlainTextFallback } = await import("@/lib/email");
    expect(
      htmlToPlainTextFallback(
        '<p>Neue Treffer</p><a href="https://gavel.test/bayern/foo">Zum Objekt →</a>',
      ),
    ).toContain("https://gavel.test/bayern/foo");
    expect(htmlToPlainTextFallback('<a href="javascript:alert(1)">x</a>')).toBe("x");
  });

  it("bindet Alert-Bilder an App-Pfade, nicht an Fremd-Hosts", async () => {
    const { isSafeAlertImageUrl, publicAlertImageUrl } = await import("@/lib/email");
    expect(isSafeAlertImageUrl("https://cdn.example/zvg-images/foto.jpg")).toBe(true);
    expect(isSafeAlertImageUrl("/zvg-images/abc.jpg")).toBe(true);
    expect(isSafeAlertImageUrl("https://cdn.example/foto.jpg")).toBe(false);
    expect(isSafeAlertImageUrl("http://cdn.example/foto.jpg")).toBe(false);
    expect(isSafeAlertImageUrl("javascript:alert(1)")).toBe(false);
    expect(
      publicAlertImageUrl("https://cdn.example/zvg-images/foto.jpg", "https://gavel.test"),
    ).toBe("https://gavel.test/zvg-images/foto.jpg");
    expect(publicAlertImageUrl("/zvg-images/abc.jpg", "https://gavel.test")).toBe(
      "https://gavel.test/zvg-images/abc.jpg",
    );
  });

  it("sendAlertEmail verwirft unsichere Bild- und Objektlinks", async () => {
    const { sendAlertEmail } = await import("@/lib/email");
    await sendAlertEmail({
      to: "user@test.local",
      userName: "Test",
      alertName: "Sicher",
      listings: [
        {
          typ: "Haus",
          adresse: "Weg 1",
          verkehrswert: 1,
          slug: 'foo" onclick=alert(1)',
          bundesland: "nrw",
          imageUrl: 'javascript:alert(1)"',
        },
      ],
    });
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    expect(html).toContain('href="https://gavel.test"');
  });

  it("sendEmailChangeConfirmEmail enthält Bestätigungslink", async () => {
    const { sendEmailChangeConfirmEmail } = await import("@/lib/email");
    const rid = "ab".repeat(16);
    const confirmUrl = `https://gavel.test/login/confirm-email?rid=${rid}`;
    await sendEmailChangeConfirmEmail({
      to: "neu@test.local",
      userName: "Ada",
      confirmUrl,
    });
    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.subject).toContain("E-Mail");
    expect(payload.to).toBe("neu@test.local");
    expect(payload.html).toContain(confirmUrl);
    expect(payload.text).toContain(confirmUrl);
  });

  it("sendEmailChangeConfirmEmail bindet Confirm-Links an rid und https", async () => {
    const { sendEmailChangeConfirmEmail } = await import("@/lib/email");
    await sendEmailChangeConfirmEmail({
      to: "neu@test.local",
      userName: "Ada",
      confirmUrl: "javascript:alert(1)",
    });
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("token=");
    await sendEmailChangeConfirmEmail({
      to: "neu@test.local",
      userName: "Ada",
      confirmUrl: "https://gavel.test/login/confirm-email?token=abc",
    });
    const tokenHtml = sendMailMock.mock.calls[1][0].html as string;
    expect(tokenHtml).not.toContain("confirm-email?token=abc");
  });

  it("sendEmailChangeNoticeEmail geht an die bisherige Adresse", async () => {
    const { sendEmailChangeNoticeEmail } = await import("@/lib/email");
    await sendEmailChangeNoticeEmail({
      to: "alt@test.local",
      userName: "Ada",
      newEmail: "neu@test.local",
    });
    const payload = sendMailMock.mock.calls[0][0];
    expect(payload.to).toBe("alt@test.local");
    expect(payload.html).toContain("neu@test.local");
  });

  it("sendDataQualityReportEmail bindet Dashboard-Links an https", async () => {
    const { sendDataQualityReportEmail } = await import("@/lib/email");
    await sendDataQualityReportEmail({
      to: "admin@test.local",
      totalActive: 10,
      totalNeedsReview: 1,
      bySource: { zvg: 1 },
      topReasons: [],
      dashboardUrl: 'javascript:alert(1)" onclick="x',
    });
    const html = sendMailMock.mock.calls[0][0].html as string;
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("onclick");
    await sendDataQualityReportEmail({
      to: "admin@test.local",
      totalActive: 10,
      totalNeedsReview: 1,
      bySource: { zvg: 1 },
      topReasons: [],
      dashboardUrl: "https://gavel.test/investor/datenbasis",
    });
    const safe = sendMailMock.mock.calls[1][0].html as string;
    expect(safe).toContain('href="https://gavel.test/investor/datenbasis"');
  });

  it("sendDataQualityReportEmail enthält Datenqualität im Betreff", async () => {
    const { sendDataQualityReportEmail } = await import("@/lib/email");
    await sendDataQualityReportEmail({
      to: "admin@test.local",
      totalActive: 100,
      totalNeedsReview: 5,
      bySource: { zvg: 3 },
      topReasons: [{ field: "verkehrswert", reason: "missing", count: 2 }],
    });

    const subject = sendMailMock.mock.calls[0][0].subject as string;
    expect(subject).toContain("Datenqualität");
  });
});
