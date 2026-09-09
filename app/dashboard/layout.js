// The dashboard gets the full width; the marketing pages keep their column.
export const metadata = { title: "EasyCall — Dashboard" };

export default function DashboardLayout({ children }) {
  return <div style={{ margin: "-72px -24px -96px", padding: "0 0 40px" }}>{children}</div>;
}
