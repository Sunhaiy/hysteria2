import { ImageResponse } from "next/og";
import { getPublicSiteInfo, publicSiteDescription } from "@/lib/seo";

export const alt = "素心 Network 稳定网络服务";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function OpenGraphImage() {
  const site = await getPublicSiteInfo();
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "72px 82px",
        background: "#f5f7f6",
        color: "#111714",
        fontFamily: "Arial, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        <div
          style={{
            width: 58,
            height: 58,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "2px solid #151a17",
            borderRadius: 8,
            background: "#20a663",
            color: "white",
            fontSize: 27,
            fontWeight: 700,
          }}
        >
          S
        </div>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{site.name}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
        <div
          style={{
            maxWidth: 920,
            fontSize: 62,
            lineHeight: 1.15,
            fontWeight: 700,
          }}
        >
          稳定连接，清晰抵达
        </div>
        <div style={{ maxWidth: 860, color: "#46514b", fontSize: 28 }}>
          {publicSiteDescription(site)}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <div style={{ width: 68, height: 6, background: "#20a663" }} />
        <div style={{ color: "#66716b", fontSize: 22 }}>suxins.life</div>
      </div>
    </div>,
    size,
  );
}
