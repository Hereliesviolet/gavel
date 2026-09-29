import { AccountNav } from "@/components/account/account-nav";
import { auth } from "@/lib/auth";
import { getCurrentUser } from "@/lib/account";
import { roleIsAdmin } from "@/lib/roles";

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  const user = session?.user?.id ? await getCurrentUser(session.user.id) : null;

  return (
    <>
      <div className="px-6 py-4 border-b border-border">
        <p className="label-mono mb-1">Account</p>
        <h1 className="text-2xl font-semibold tracking-tight">Account &amp; Einstellungen</h1>
      </div>
      <div className="flex flex-col lg:grid lg:grid-cols-[220px_1fr] min-h-[80vh]">
        <AccountNav isAdmin={roleIsAdmin(user?.role)} />
        <main className="p-4 sm:p-6 min-w-0">{children}</main>
      </div>
    </>
  );
}
