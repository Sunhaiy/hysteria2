import { formatDateTime } from "@/lib/format";
import type { SupportTicketMessage } from "@/lib/ticket-types";

export function TicketThread({
  messages,
}: {
  messages: SupportTicketMessage[];
}) {
  if (!messages.length) {
    return <div className="empty-state">该工单还没有消息。</div>;
  }
  return (
    <div className="ticket-thread">
      {messages.map((message) => (
        <article
          className={`ticket-message ${message.author.role}`}
          key={message.id}
        >
          <div className="ticket-message-meta">
            <strong>{message.author.displayName}</strong>
            <span
              className={`badge ${message.author.role === "admin" ? "info" : "neutral"}`}
            >
              {message.author.role === "admin" ? "客服" : "用户"}
            </span>
            <time>{formatDateTime(message.createdAt)}</time>
          </div>
          <p>{message.body}</p>
        </article>
      ))}
    </div>
  );
}
