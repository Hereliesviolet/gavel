export const MIN_PASSWORD_LENGTH = 10;

export function passwordPolicyError(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.`;
  }
  if (!/[A-Za-zÄÖÜäöüß]/.test(password) || !/\d/.test(password)) {
    return "Das Passwort braucht mindestens einen Buchstaben und eine Ziffer.";
  }
  return null;
}
