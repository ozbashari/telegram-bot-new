// src/app/page.tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface DashboardStats {
  publishedToday: number;
  pendingCount: number;
  totalPublished: number;
  estimatedCommission: number;
}

interface RecentProduct {
  id: string;
  titleHe: string | null;
  titleOriginal: string;
  imageUrl: string;
  publishedAt: string | null;
  channel: { name: string };
}

interface ChannelSummary {
  id: string;
  name: string;
  isActive: boolean;
  autoPublish: boolean;
  lastPublishedAt: string | null;
  pendingCount: number;
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({ publishedToday: 0, pendingCount: 0, totalPublished: 0, estimatedCommission: 0 });
  const [botActive, setBotActive] = useState(true);
  const [recentPublished, setRecentPublished] = useState<RecentProduct[]>([]);
  const [channelsSummary, setChannelsSummary] = useState<ChannelSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [isTogglingBot, setIsTogglingBot] = useState(false);
  const [scanMsg, setScanMsg] = useState<{ text: string; isError: boolean } | null>(null);

  const fetchData = async () => {
    try {
      const res = await fetch('/api/dashboard/stats');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setBotActive(data.botActive);
        setRecentPublished(data.recentPublished || []);
        setChannelsSummary(data.channelsSummary || []);
      }
    } catch (err) {
      console.error('Error fetching dashboard stats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleToggleBot = async () => {
    if (isTogglingBot) return;
    setIsTogglingBot(true);
    const newStatus = !botActive;
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'settings', data: { bot_active: String(newStatus) } }),
      });
      const data = await res.json();
      if (data.success) {
        setBotActive(newStatus);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsTogglingBot(false);
    }
  };

  const handleScanNow = async () => {
    if (isScanning) return;
    setIsScanning(true);
    setScanMsg(null);
    try {
      // Load settings dynamically to grab cron_secret
      const settingsRes = await fetch('/api/settings');
      const settingsData = await settingsRes.json();
      const cronSecret = settingsData.settings?.cron_secret || '';

      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (cronSecret) {
        headers['Authorization'] = `Bearer ${cronSecret}`;
      }

      const res = await fetch('/api/products/scan', { method: 'POST', headers });
      const data = await res.json();
      if (data.success) {
        setScanMsg({
          text: `סריקה הושלמה בהצלחה! ${data.new} מוצרים חדשים נוספו לתור (${data.scanned} נסרקו, ${data.duplicates} כפילויות)`,
          isError: false
        });
        fetchData();
      } else {
        setScanMsg({ text: `שגיאה בסריקה: ${data.error || data.errors?.join(', ')}`, isError: true });
      }
    } catch {
      setScanMsg({ text: 'שגיאת תקשורת מול השרת', isError: true });
    } finally {
      setIsScanning(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '65vh', gap: '1rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }}></div>
        <p style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)', fontWeight: 500 }}>טוען נתוני לוח בקרה...</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Header */}
      <div className="page-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1.5rem' }}>
        <div>
          <h1 className="gradient-text" style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', letterSpacing: '-0.03em' }}>
            לוח בקרה ראשי
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
            ניטור היסטוריית פרסומים, עמלות שותפים וסריקות אוטומטיות של AliExpress.
          </p>
        </div>
        
        {/* Quick Link Buttons */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <Link href="/manual">
            <button className="btn btn-secondary" style={{ padding: '0.65rem 1.25rem' }}>➕ הזנה ידנית</button>
          </Link>
          <Link href="/queue">
            <button className="btn btn-primary" style={{ padding: '0.65rem 1.25rem' }}>⏳ תור האישורים ({stats.pendingCount})</button>
          </Link>
        </div>
      </div>

      {/* Stats Cards Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem' }}>
        
        {/* Published Today */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative', overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>פורסמו היום</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>{stats.publishedToday}</span>
          <span style={{ color: 'var(--accent-green)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.5rem' }}>
            <span className="pulse-dot" style={{ width: 6, height: 6, display: 'inline-block' }} /> עדכון שוטף
          </span>
          <div style={{ position: 'absolute', left: '-10px', bottom: '-15px', fontSize: '5rem', opacity: 0.03, userSelect: 'none' }}>📣</div>
        </div>

        {/* Pending Products */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative', overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>ממתינים לאישור</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: stats.pendingCount > 0 ? 'var(--accent-amber)' : '#ffffff', lineHeight: 1.1 }}>
            {stats.pendingCount}
          </span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>מוצרים שממתינים ב-Queue</span>
          <div style={{ position: 'absolute', left: '-10px', bottom: '-15px', fontSize: '5rem', opacity: 0.03, userSelect: 'none' }}>⏳</div>
        </div>

        {/* Total Published */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative', overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>סה״כ פורסמו</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', lineHeight: 1.1 }}>{stats.totalPublished}</span>
          <span style={{ color: 'var(--accent-blue)', fontSize: '0.8rem', marginTop: '0.5rem' }}>סך הכל פרסומים מוצלחים</span>
          <div style={{ position: 'absolute', left: '-10px', bottom: '-15px', fontSize: '5rem', opacity: 0.03, userSelect: 'none' }}>✅</div>
        </div>

        {/* Estimated Commission */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative', overflow: 'hidden' }}>
          <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', fontWeight: 500 }}>עמלה משוערת</span>
          <span style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent-green)', lineHeight: 1.1 }}>${stats.estimatedCommission.toFixed(2)}</span>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '0.5rem' }}>ממוצע עמלה × מספר פרסומים</span>
          <div style={{ position: 'absolute', left: '-10px', bottom: '-15px', fontSize: '5rem', opacity: 0.03, userSelect: 'none' }}>💰</div>
        </div>
      </div>

      {/* Automation Bot Settings & Operations */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        
        {/* Switch Card */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>בוט סריקה ופרסום</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
              שליטה בהפעלה האוטומטית של המערכת. כשהבוט פעיל, ה-Cron Job יסרוק מוצרים חדשים, יבצע מונטיזציה, יפיק תוכן AI ויפרסם לערוצים באופן אוטומטי.
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
            <div className={`toggle-container ${botActive ? 'toggle-active' : ''}`} onClick={handleToggleBot}>
              <div className="toggle-switch"></div>
              <span style={{ fontWeight: 600, fontSize: '0.95rem', color: botActive ? '#ffffff' : 'var(--text-secondary)' }}>
                {botActive ? 'בוט אוטומטי פעיל ✅' : 'בוט אוטומטי כבוי ❌'}
              </span>
            </div>
            {isTogglingBot && <div className="spinner" style={{ width: '16px', height: '16px' }}></div>}
          </div>
        </div>

        {/* Scan Actions */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: '1.5rem' }}>
          <div>
            <h3 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>סריקה ידנית</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', lineHeight: 1.5 }}>
              הפעלת סריקת AliExpress מיידית על כל הקטגוריות והערוצים הפעילים ללא המתנה לתזמון ה-Cron הקיים במערכת.
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <button className="btn btn-primary" onClick={handleScanNow} disabled={isScanning} style={{ width: '100%' }}>
              {isScanning ? (
                <>
                  <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
                  סורק מוצרים...
                </>
              ) : (
                '🔄 סרוק מוצרים עכשיו'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Scan Results Message */}
      {scanMsg && (
        <div 
          className="glass-card" 
          style={{ 
            padding: '1rem 1.5rem', 
            backgroundColor: scanMsg.isError ? 'rgba(244, 63, 94, 0.08)' : 'rgba(16, 185, 129, 0.08)',
            borderColor: scanMsg.isError ? 'rgba(244, 63, 94, 0.2)' : 'rgba(16, 185, 129, 0.2)',
            color: scanMsg.isError ? '#f87171' : '#34d399',
            fontWeight: 500,
            fontSize: '0.9rem',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem'
          }}
        >
          <span>{scanMsg.isError ? '⚠️' : '✅'}</span>
          <span>{scanMsg.text}</span>
        </div>
      )}

      {/* Main Content Layout Block: Recent published + Channels Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '1.5rem', alignItems: 'start' }}>
        
        {/* Recent Published */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>פרסומים אחרונים</h3>
          {recentPublished.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '3rem 0' }}>
              אין פרסומים עדיין במערכת. לחץ &quot;סרוק עכשיו&quot; או הוסף מוצר ידנית כדי להתחיל.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              {recentPublished.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '1rem', paddingBottom: '0.75rem', borderBottom: '1px solid rgba(255, 255, 255, 0.04)' }}>
                  {p.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img 
                      src={p.imageUrl} 
                      alt="" 
                      style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-primary)' }} 
                    />
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, gap: '0.2rem' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#ffffff', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {p.titleHe || p.titleOriginal}
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '0.775rem', color: 'var(--text-secondary)' }}>
                      <span>ערוץ: <strong>{p.channel?.name}</strong></span>
                      <span>•</span>
                      <span>{p.publishedAt ? new Date(p.publishedAt).toLocaleString('he-IL', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : ''}</span>
                    </div>
                  </div>
                  <span className="badge badge-success" style={{ fontSize: '0.7rem' }}>פורסם</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channels Summary */}
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
          <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>ערוצי טלגרם</h3>
          {channelsSummary.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '2rem 0' }}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>לא מוגדרים ערוצים פעילים.</p>
              <Link href="/settings">
                <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.85rem' }}>הוסף ערוץ חדש</button>
              </Link>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {channelsSummary.map((ch) => (
                <div 
                  key={ch.id} 
                  style={{ 
                    padding: '1rem', 
                    borderRadius: '12px', 
                    background: 'rgba(255, 255, 255, 0.01)', 
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.5rem'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 650, color: '#ffffff', fontSize: '0.95rem' }}>{ch.name}</span>
                    <span className={`badge ${ch.isActive ? 'badge-success' : 'badge-danger'}`} style={{ fontSize: '0.65rem' }}>
                      {ch.isActive ? 'פעיל' : 'מנוטרל'}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>סגנון פרסום:</span>
                      <span style={{ color: ch.autoPublish ? 'var(--accent-blue)' : 'var(--text-secondary)', fontWeight: 500 }}>
                        {ch.autoPublish ? 'אוטומטי' : 'ידני (Queue)'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>ממתינים בתור:</span>
                      <span style={{ color: ch.pendingCount > 0 ? 'var(--accent-amber)' : 'var(--text-secondary)', fontWeight: 600 }}>
                        {ch.pendingCount}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>פרסום אחרון:</span>
                      <span>
                        {ch.lastPublishedAt 
                          ? new Date(ch.lastPublishedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })
                          : 'מעולם לא'}
                      </span>
                    </div>                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

    </div>
  );
}

