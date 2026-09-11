import Link from "next/link";

export function PublicSiteFooter({ siteName }: { siteName: string }) {
  return (
    <footer className="ppanel-footer public-site-footer">
      <div className="ppanel-container ppanel-footer-inner">
        <div className="ppanel-footer-copy">
          <strong>{siteName}</strong> © {new Date().getFullYear()} 版权所有。
        </div>
        <div className="public-site-footer-links">
          <Link href="/blog">使用指南</Link>
          <Link href="/portal/plans">查看套餐</Link>
          <Link href="/login">登录</Link>
        </div>
      </div>
    </footer>
  );
}
