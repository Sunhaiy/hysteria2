import Link from "next/link";

export function CustomerLink({
  id,
  displayName,
  email,
}: {
  id: string;
  displayName?: string | null;
  email: string;
}) {
  const name = displayName?.trim() || email;

  return (
    <Link
      className="admin-customer-link"
      href={`/admin/customers/${id}`}
      title={`查看 ${name} 的客户详情`}
    >
      <strong>{name}</strong>
      {name !== email ? <small>{email}</small> : null}
    </Link>
  );
}
