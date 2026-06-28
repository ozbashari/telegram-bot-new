// src/components/queue/TelegramPreview.tsx
'use client';

interface TelegramPreviewProps {
  channelName: string;
  imageUrl: string;
  title: string;
  body: string;
  bullets: string; // JSON array string
  cta: string;
  priceOriginal: number;
  priceDiscounted: number;
  discountPercent: number;
}

export default function TelegramPreview({
  channelName,
  imageUrl,
  title,
  body,
  bullets,
  cta,
  priceOriginal,
  priceDiscounted,
  discountPercent,
}: TelegramPreviewProps) {
  
  // Parse bullets
  let parsedBullets: string[] = [];
  try {
    if (bullets) {
      const parsed = JSON.parse(bullets);
      if (Array.isArray(parsed)) {
        parsedBullets = parsed;
      }
    }
  } catch {
    parsedBullets = [];
  }

  // Current time for watermark
  const currentTime = new Date().toLocaleTimeString('he-IL', {
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="telegram-mock-wrapper">
      <div className="telegram-channel-header">
        <div className="channel-avatar">📣</div>
        <div className="channel-info">
          <span className="channel-name">{channelName || 'ערוץ דילים'}</span>
          <span className="channel-sub text-muted">ערוץ ציבורי</span>
        </div>
      </div>

      <div className="telegram-bubble">
        {imageUrl && (
          <div className="telegram-photo-container">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={imageUrl} alt="Product Preview" className="telegram-photo" />
          </div>
        )}

        <div className="telegram-text-content">
          <div className="telegram-title"><strong>{title || 'כותרת המוצר (עברית)'}</strong></div>
          
          {body && <div className="telegram-body">{body}</div>}
          
          {parsedBullets.length > 0 && (
            <div className="telegram-bullets" style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
              {parsedBullets.map((bullet, idx) => (
                <div key={idx} className="bullet-line">
                  <span>✅</span> <span>{bullet}</span>
                </div>
              ))}
            </div>
          )}

          <div className="telegram-pricing" style={{ marginTop: '0.75rem' }}>
            <span>💰</span> <strong>מחיר: ${priceDiscounted}</strong> <del style={{ color: '#8b9bb4', fontSize: '0.85em' }}>${priceOriginal}</del>
            <br />
            <span>🔥</span> חיסכון של {discountPercent}%
          </div>

          {cta && <div className="telegram-cta" style={{ marginTop: '0.75rem' }}>{cta}</div>}

          <div className="telegram-time">{currentTime}</div>
        </div>

        <div className="telegram-action-button">
          🛒 לרכישה לחץ כאן
        </div>
      </div>

      <style jsx>{`
        .telegram-mock-wrapper {
          background-color: #17212b; /* Telegram dark mode background color */
          border: 1px solid rgba(255, 255, 255, 0.05);
          border-radius: 12px;
          padding: 1.25rem;
          color: #f5f5f5;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          max-width: 360px;
          width: 100%;
          direction: rtl;
        }

        .telegram-channel-header {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          margin-bottom: 0.75rem;
        }

        .channel-avatar {
          width: 36px;
          height: 36px;
          background: #2481cc;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.2rem;
        }

        .channel-info {
          display: flex;
          flex-direction: column;
        }

        .channel-name {
          font-weight: 600;
          font-size: 0.9rem;
          color: #ffffff;
        }

        .channel-sub {
          font-size: 0.75rem;
          color: #7f91a4;
        }

        .telegram-bubble {
          background-color: #182533; /* Bubble color */
          border-radius: 10px 10px 0 10px; /* Telegram bubble shape in RTL */
          overflow: hidden;
          box-shadow: 0 1px 2px rgba(0,0,0,0.2);
          position: relative;
        }

        .telegram-photo-container {
          width: 100%;
          max-height: 220px;
          overflow: hidden;
          background-color: #0e1621;
          display: flex;
          align-items: center;
          justify-content: center;
          border-bottom: 1px solid #101921;
        }

        .telegram-photo {
          width: 100%;
          height: auto;
          object-fit: cover;
        }

        .telegram-text-content {
          padding: 0.75rem;
          font-size: 0.875rem;
          line-height: 1.4;
          color: #f5f5f5;
          position: relative;
          padding-bottom: 1.5rem; /* Space for timestamp watermark */
        }

        .telegram-title {
          font-size: 0.95rem;
          color: #ffffff;
          margin-bottom: 0.4rem;
        }

        .bullet-line {
          display: flex;
          gap: 0.4rem;
          align-items: flex-start;
        }

        .telegram-time {
          position: absolute;
          bottom: 4px;
          left: 8px; /* water mark left side */
          font-size: 0.7rem;
          color: #7f91a4;
        }

        .telegram-action-button {
          background-color: #2481cc; /* Telegram button blue */
          color: #ffffff;
          font-weight: 600;
          text-align: center;
          padding: 0.65rem;
          font-size: 0.85rem;
          cursor: pointer;
          transition: background-color 0.15s ease;
          border-top: 1px solid #1e2c3a;
          user-select: none;
        }

        .telegram-action-button:hover {
          background-color: #2a8fdc;
        }
      `}</style>
    </div>
  );
}
