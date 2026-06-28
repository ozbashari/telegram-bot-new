// src/app/manual/page.tsx
'use client';

import { useEffect, useState } from 'react';
import TelegramPreview from '@/components/queue/TelegramPreview';

interface Channel {
  id: string;
  name: string;
  isActive: boolean;
}

interface Product {
  id: string;
  aliexpressProductId: string;
  titleOriginal: string;
  titleHe: string | null;
  bodyHe: string | null;
  bulletsHe: string | null; // JSON array string
  ctaHe: string | null;
  priceOriginal: number;
  priceDiscounted: number;
  discountPercent: number;
  imageUrl: string;
  affiliateLink: string | null;
  channelId: string;
}

export default function ManualPage() {
  const [channels, setChannels] = useState<Channel[]>([]);
  const [selectedChannelId, setSelectedChannelId] = useState<string>('');
  const [productUrl, setProductUrl] = useState<string>('');
  
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [isPublishing, setIsPublishing] = useState<boolean>(false);
  const [isSavingChanges, setIsSavingChanges] = useState<boolean>(false);
  
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [successMessage, setSuccessMessage] = useState<string>('');
  const [product, setProduct] = useState<Product | null>(null);

  // Hebrew copy edit states
  const [editTitle, setEditTitle] = useState<string>('');
  const [editBody, setEditBody] = useState<string>('');
  const [editBullets, setEditBullets] = useState<string[]>(['', '', '']);
  const [editCta, setEditCta] = useState<string>('');

  useEffect(() => {
    const fetchChannels = async () => {
      try {
        const res = await fetch('/api/settings');
        const data = await res.json();
        if (data.success && data.channels) {
          const activeChannels = data.channels.filter((c: Channel) => c.isActive);
          setChannels(activeChannels);
          if (activeChannels.length > 0) {
            setSelectedChannelId(activeChannels[0].id);
          }
        }
      } catch (err) {
        console.error('Error fetching active channels:', err);
      }
    };
    fetchChannels();
  }, []);

  const handleProcessProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productUrl || !selectedChannelId) return;

    setIsProcessing(true);
    setErrorMessage('');
    setSuccessMessage('');
    setProduct(null);

    try {
      const res = await fetch('/api/products/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: productUrl,
          channelId: selectedChannelId,
        }),
      });
      const data = await res.json();

      if (data.success && data.product) {
        const prod = data.product as Product;
        setProduct(prod);
        setEditTitle(prod.titleHe || '');
        setEditBody(prod.bodyHe || '');
        
        let parsedBullets: string[] = ['', '', ''];
        try {
          if (prod.bulletsHe) {
            const arr = JSON.parse(prod.bulletsHe);
            if (Array.isArray(arr)) {
              parsedBullets = [
                arr[0] || '',
                arr[1] || '',
                arr[2] || '',
              ];
            }
          }
        } catch {
          // ignore
        }
        setEditBullets(parsedBullets);
        setEditCta(prod.ctaHe || '');
      } else {
        setErrorMessage(data.error || 'כשל בעיבוד המוצר. ודא שהקישור תקין ונסה שוב.');
      }
    } catch (err) {
      setErrorMessage('שגיאת שרת תקשורת: ' + (err as Error).message);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBulletChange = (index: number, val: string) => {
    const updated = [...editBullets];
    updated[index] = val;
    setEditBullets(updated);
  };

  const handleSaveChanges = async () => {
    if (!product) return;
    setIsSavingChanges(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await fetch('/api/products/edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          titleHe: editTitle,
          bodyHe: editBody,
          bulletsHe: editBullets.filter(b => b.trim() !== ''),
          ctaHe: editCta,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccessMessage('השינויים נשמרו בהצלחה!');
        // Update local product state with updated values
        setProduct({
          ...product,
          titleHe: editTitle,
          bodyHe: editBody,
          bulletsHe: JSON.stringify(editBullets.filter(b => b.trim() !== '')),
          ctaHe: editCta,
        });
      } else {
        setErrorMessage(data.error || 'שמירת השינויים נכשלה.');
      }
    } catch (err) {
      setErrorMessage('שגיאה בשמירת שינויים: ' + (err as Error).message);
    } finally {
      setIsSavingChanges(false);
    }
  };

  const handlePublishNow = async () => {
    if (!product) return;
    
    // Auto-save changes first
    await handleSaveChanges();

    setIsPublishing(true);
    setErrorMessage('');
    setSuccessMessage('');

    try {
      const res = await fetch('/api/telegram/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId: product.id,
          channelId: product.channelId,
        }),
      });
      const data = await res.json();

      if (data.success) {
        setSuccessMessage('המוצר פורסם בהצלחה לערוץ הטלגרם! 🎉');
        // Reset state
        setProduct(null);
        setProductUrl('');
      } else {
        setErrorMessage(data.error || 'הפרסום לטלגרם נכשל. בדוק את הגדרות הערוץ והבוט.');
      }
    } catch (err) {
      setErrorMessage('שגיאה בפרסום ההודעה: ' + (err as Error).message);
    } finally {
      setIsPublishing(false);
    }
  };

  const handleSaveToQueue = async () => {
    // Save any pending changes
    await handleSaveChanges();
    setSuccessMessage('המוצר נשמר בהצלחה בתור האישורים! 📥');
    // Clear and reset form
    setProduct(null);
    setProductUrl('');
  };

  const selectedChannelName = channels.find(c => c.id === selectedChannelId)?.name || 'ערוץ דילים';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      
      {/* Header */}
      <div className="page-header">
        <h1 className="gradient-text" style={{ fontSize: '2.5rem', fontWeight: 800, marginBottom: '0.5rem', letterSpacing: '-0.03em' }}>
          הזנה ידנית
        </h1>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem' }}>
          הוספה ועיבוד של מוצר בודד מ-AliExpress לפי קישור. המערכת תבצע מונטיזציה ותנסח פוסט AI באופן מיידי.
        </p>
      </div>

      {/* Input Ingestion Form */}
      {!product && (
        <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          <form onSubmit={handleProcessProduct} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="product-url">קישור למוצר מ-AliExpress או מזהה מוצר</label>
              <input
                id="product-url"
                type="text"
                className="form-input"
                placeholder="https://www.aliexpress.com/item/1005001234567890.html"
                value={productUrl}
                onChange={(e) => setProductUrl(e.target.value)}
                required
                disabled={isProcessing}
                style={{ direction: 'ltr', textAlign: 'left', fontFamily: 'monospace' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label" htmlFor="channel-select">ערוץ טלגרם מיועד</label>
              {channels.length === 0 ? (
                <p style={{ color: 'var(--accent-pink)', fontSize: '0.9rem' }}>
                  שגיאה: אין ערוצים פעילים מוגדרים במערכת. נא ליצור ערוץ פעיל תחת לשונית הגדרות תחילה.
                </p>
              ) : (
                <select
                  id="channel-select"
                  className="form-input"
                  value={selectedChannelId}
                  onChange={(e) => setSelectedChannelId(e.target.value)}
                  disabled={isProcessing}
                  style={{ background: 'var(--bg-secondary)', cursor: 'pointer' }}
                >
                  {channels.map((ch) => (
                    <option key={ch.id} value={ch.id}>
                      {ch.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <button 
              type="submit" 
              className="btn btn-primary" 
              disabled={isProcessing || channels.length === 0}
              style={{ width: '100%', marginTop: '0.5rem', minHeight: '46px' }}
            >
              {isProcessing ? (
                <>
                  <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
                  מושך נתונים ומחבר ל-AI...
                </>
              ) : (
                '🚀 מעבד ומנסח מוצר'
              )}
            </button>
          </form>
        </div>
      )}

      {/* Ingestion Alerts */}
      {errorMessage && (
        <div className="badge badge-danger" style={{ display: 'block', padding: '1rem', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500 }}>
          ⚠️ שגיאה: {errorMessage}
        </div>
      )}
      {successMessage && (
        <div className="badge badge-success" style={{ display: 'block', padding: '1rem', borderRadius: '8px', fontSize: '0.95rem', fontWeight: 500 }}>
          ✅ {successMessage}
        </div>
      )}

      {/* Editor & Preview Display Grid */}
      {product && (
        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '2rem', alignItems: 'start' }}>
          
          {/* Editor Form Card */}
          <div className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h3 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>עריכת תוכן המודעה</h3>
            
            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">כותרת המודעה (עברית)</label>
              <input
                type="text"
                className="form-input"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">תיאור המוצר (2-3 משפטים בעברית)</label>
              <textarea
                className="form-input"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                style={{ minHeight: '90px' }}
              />
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">נקודות יתרונות (עד 3 יתרונות)</label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="יתרון ראשון"
                    value={editBullets[0]}
                    onChange={(e) => handleBulletChange(0, e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="יתרון שני"
                    value={editBullets[1]}
                    onChange={(e) => handleBulletChange(1, e.target.value)}
                  />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span style={{ fontSize: '1.1rem' }}>✅</span>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="יתרון שלישי"
                    value={editBullets[2]}
                    onChange={(e) => handleBulletChange(2, e.target.value)}
                  />
                </div>
              </div>
            </div>

            <div className="form-group" style={{ margin: 0 }}>
              <label className="form-label">קריאה לפעולה (CTA)</label>
              <input
                type="text"
                className="form-input"
                value={editCta}
                onChange={(e) => setEditCta(e.target.value)}
              />
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button 
                className="btn btn-secondary" 
                onClick={handleSaveChanges} 
                disabled={isSavingChanges}
                style={{ flex: 1 }}
              >
                {isSavingChanges ? 'שומר שינויים...' : '💾 שמור שינויים'}
              </button>
              
              <button
                className="btn btn-danger"
                onClick={() => {
                  setProduct(null);
                  setProductUrl('');
                  setErrorMessage('');
                  setSuccessMessage('');
                }}
                disabled={isPublishing || isSavingChanges}
              >
                ביטול
              </button>
            </div>

            {/* Ingestion Output Actions */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
              <button
                className="btn btn-primary"
                onClick={handlePublishNow}
                disabled={isPublishing || isSavingChanges}
                style={{ width: '100%', minHeight: '44px' }}
              >
                {isPublishing ? (
                  <>
                    <div className="spinner" style={{ width: '18px', height: '18px' }}></div>
                    מפרסם לטלגרם...
                  </>
                ) : (
                  '✅ פרסם לערוץ עכשיו'
                )}
              </button>

              <button
                className="btn btn-secondary"
                onClick={handleSaveToQueue}
                disabled={isPublishing || isSavingChanges}
                style={{ width: '100%', border: '1px solid var(--accent-blue)', color: 'var(--accent-blue)', minHeight: '44px' }}
              >
                📥 שמור לתור האישורים (בלי לפרסם)
              </button>
            </div>
          </div>

          {/* Real-time Telegram Preview Display Card */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', alignItems: 'center' }}>
            <h4 style={{ color: 'var(--text-secondary)', alignSelf: 'flex-start', fontFamily: 'var(--font-display)', fontWeight: 600 }}>תצוגה מקדימה (טלגרם)</h4>
            <TelegramPreview
              channelName={selectedChannelName}
              imageUrl={product.imageUrl}
              title={editTitle}
              body={editBody}
              bullets={JSON.stringify(editBullets.filter(b => b.trim() !== ''))}
              cta={editCta}
              priceOriginal={product.priceOriginal}
              priceDiscounted={product.priceDiscounted}
              discountPercent={product.discountPercent}
            />
          </div>
        </div>
      )}
    </div>
  );
}
