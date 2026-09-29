import { InvestorSubnav } from "@/components/investor/investor-subnav";

export default function InvestorLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <InvestorSubnav />
      {children}
    </>
  );
}
