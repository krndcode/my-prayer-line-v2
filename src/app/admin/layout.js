
import AdminShell from "@/components/admin/AdminShell";

export const metadata = {
  title: "Administration | My Prayer Line",
  description: "My Prayer Line platform administration.",
};

export default function AdminLayout({ children }) {
  return <AdminShell>{children}</AdminShell>;
}
