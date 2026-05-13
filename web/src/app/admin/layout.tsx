import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Village Studio — Admin",
  description: "Admin panel for Village Studio check-in system.",
};

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
