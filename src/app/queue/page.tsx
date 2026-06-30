// src/app/queue/page.tsx
'use client';

import { useState, useEffect, useCallback } from 'react';
import TelegramPreview from '@/components/queue/TelegramPreview';

type Channel = {
  id: string;
  name: string;
  telegramChatId: string;
};

type Product = {
  id: string;
  aliexpressProductId: string;
  titleOriginal: string;
  titleHe: string | null;
  bodyHe: string | null;
  bulletsHe: string | null; // JSON string
  ctaHe: string | null;
  priceOriginal: number;
  priceDiscounted: number;
  discountPercent: number;
  imageUrl: string;
  affiliateLink: string | null;
  categoryId: string;
  commissionRate: number;
  rating: number;
  salesCount: number;
  status: string;
  channelId: string;
  createdAt: string;
  channel: Channel;
};

export default function QueuePage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [channels, setChannels] = useState<Channel[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkProcessing, setIsBulkProcessing] = useState(false);

  // Filters state
  const [selectedChannel, setSelectedChannel] = useState<string>('all');
  const [selectedStatus, setSelectedStatus] = useState<string>('pending'); // pending or ai_failed

  // Form edit states (mapped by productId)
  const [editForms, setEditForms] = useState<Record<string, {
    titleHe: string;
    bodyHe: string;
    bulletsHe: string; // new-line separated
    ctaHe: string;
  }>>({});

  // Fetch pending products (channels are embedded in product.channel)
  const fetchProducts = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMsg(null);

      let productUrl = `/api/products?status=${selectedStatus}&limit=40`;
      if (selectedChannel !== 'all') {
        productUrl += `&channelId=${selectedChannel}`;
      }

      // Run both fetches in parallel
      const [productsRes, settingsRes] = await Promise.all([
        fetch(productUrl),
        fetch('/api/settings'),
      ]);

      const [productsData, settingsData] = await Promise.all([
        productsRes.json(),
        settingsRes.json(),
      ]);

      if (settingsData.success) {
        setChannels(settingsData.channels || []);
      }

      if (productsData.success) {
        const fetchedProducts: Product[] = productsData.products || [];
        setProducts(fetchedProducts);

        const forms: Record<string, {
          titleHe: string;
          bodyHe: string;
          bulletsHe: string;
          ctaHe: string;
        }> = {};
        fetchedProducts.forEach((product) => {
          let bulletText = '';
          try {
            if (product.bulletsHe) {
              const parsed = JSON.parse(product.bulletsHe);
              bulletText = Array.isArray(parsed) ? parsed.join('\n') : '';
            }
          } catch {
            bulletText = product.bulletsHe || '';
          }
          forms[product.id] = {
            titleHe: product.titleHe || '',
            bodyHe: product.bodyHe || '',
            bulletsHe: bulletText,
            ctaHe: product.ctaHe || '',
          };
        });
        setEditForms(forms);
      } else {
        setErrorMsg(productsData.error || 'טעינת תור האישורים נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בטעינת מוצרים.');
    } finally {
      setLoading(false);
    }
  }, [selectedChannel, selectedStatus]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Input change handler
  const handleInputChange = (productId: string, field: string, value: string) => {
    setEditForms((prev) => ({
      ...prev,
      [productId]: {
        ...prev[productId],
        [field]: value,
      },
    }));
  };

  // Save changes locally in DB (PATCH /api/products/edit)
  const saveProductChanges = async (productId: string) => {
    const form = editForms[productId];
    if (!form) return false;

    // Convert new-line separated bullets to array
    const bulletsArray = form.bulletsHe
      .split('\n')
      .map(b => b.trim())
      .filter(Boolean);

    try {
      setProcessingId(productId);
      setErrorMsg(null);
      const res = await fetch('/api/products/edit', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          productId,
          titleHe: form.titleHe,
          bodyHe: form.bodyHe,
          bulletsHe: bulletsArray,
          ctaHe: form.ctaHe,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('השינויים נשמרו במסד הנתונים בהצלחה ✅');
        return true;
      } else {
        setErrorMsg(data.error || 'שמירת השינויים נכשלה.');
        return false;
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת תקשורת בשמירת שינויים.');
      return false;
    } finally {
      setProcessingId(null);
    }
  };

  // Approve & Publish
  const handleApprove = async (productId: string) => {
    // 1. Auto-save changes first
    const savedOk = await saveProductChanges(productId);
    if (!savedOk) return;

    try {
      setProcessingId(productId);
      setErrorMsg(null);
      const res = await fetch('/api/products/approve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('המוצר פורסם לערוץ הטלגרם בהצלחה! 🚀');
        // Remove from list
        setProducts(prev => prev.filter(p => p.id !== productId));
      } else {
        setErrorMsg(data.error || 'אישור ופרסום המוצר נכשל.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בפרסום מוצר.');
    } finally {
      setProcessingId(null);
    }
  };

  // Reject / Delete product
  const handleReject = async (productId: string) => {
    try {
      setProcessingId(productId);
      setErrorMsg(null);
      const res = await fetch('/api/products/reject', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('המוצר נדחה והוסר מתור האישורים 🗑️');
        setProducts(prev => prev.filter(p => p.id !== productId));
      } else {
        setErrorMsg(data.error || 'דחיית המוצר נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בדחיית מוצר.');
    } finally {
      setProcessingId(null);
    }
  };

  // Bulk selection helpers
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === products.length && products.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(products.map(p => p.id)));
    }
  };

  const handleBulkPublish = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`לפרסם ${selectedIds.size} מוצרים לטלגרם?`)) return;
    setIsBulkProcessing(true);
    setErrorMsg(null);
    try {
      const productIds = Array.from(selectedIds);
      // Auto-save all selected products first
      for (const id of productIds) {
        await saveProductChanges(id);
      }
      const res = await fetch('/api/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'publish', productIds }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess(`${data.successCount}/${data.total} מוצרים פורסמו בהצלחה 🚀`);
        setProducts(prev => prev.filter(p => !selectedIds.has(p.id)));
        setSelectedIds(new Set());
      } else {
        setErrorMsg(data.error || 'פרסום מרובה נכשל');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בפרסום מרובה');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  const handleBulkReject = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`למחוק ${selectedIds.size} מוצרים מהתור?`)) return;
    setIsBulkProcessing(true);
    setErrorMsg(null);
    try {
      const productIds = Array.from(selectedIds);
      const res = await fetch('/api/products/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reject', productIds }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess(`${data.count} מוצרים הוסרו מהתור 🗑️`);
        setProducts(prev => prev.filter(p => !selectedIds.has(p.id)));
        setSelectedIds(new Set());
      } else {
        setErrorMsg(data.error || 'מחיקה מרובה נכשלה');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת במחיקה מרובה');
    } finally {
      setIsBulkProcessing(false);
    }
  };

  // Regenerate Copy with AI (POST /api/products/generate)
  const handleRegenerateAi = async (productId: string) => {
    try {
      setProcessingId(productId);
      setErrorMsg(null);
      const res = await fetch('/api/products/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('התוכן השיווקי נוצר מחדש בהצלחה על ידי ה-AI 🔄');
        // For simplicity, let's refresh products list to get exact database updates
        await fetchProducts();
      } else {
        setErrorMsg(data.error || 'יצירת תוכן מחדש נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בפעולת ה-AI.');
    } finally {
      setProcessingId(null);
    }
  };

  return (
    <div className="queue-page">
      <div className="page-header" style={{ marginBottom: '2.5rem' }}>
        <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>תור אישורים ומתינים</h1>
        <p style={{ color: 'var(--text-secondary)' }}>ערוך את התוכן השיווקי, צפה בתצוגה מקדימה מדויקת של טלגרם ואשר פרסום ידנית.</p>
      </div>

      {/* Filters Bar */}
      <div className="glass-card" style={{ padding: '1.25rem 2rem', marginBottom: '2rem', display: 'flex', flexWrap: 'wrap', gap: '2rem', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>סנן לפי ערוץ:</label>
          <select 
            className="form-input" 
            style={{ width: '200px', padding: '0.5rem' }} 
            value={selectedChannel} 
            onChange={(e) => setSelectedChannel(e.target.value)}
          >
            <option value="all">כל הערוצים</option>
            {channels.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <label className="form-label" style={{ margin: 0, whiteSpace: 'nowrap' }}>סטטוס מוצר:</label>
          <select 
            className="form-input" 
            style={{ width: '180px', padding: '0.5rem' }} 
            value={selectedStatus} 
            onChange={(e) => setSelectedStatus(e.target.value)}
          >
            <option value="pending">ממתין לאישור (Pending)</option>
            <option value="ai_failed">שגיאות AI (Failed AI)</option>
          </select>
        </div>

        <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={fetchProducts}>
          🔄 רענן
        </button>

        {products.length > 0 && (
          <button className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }} onClick={toggleSelectAll}>
            {selectedIds.size === products.length ? '☐ בטל הכל' : `☑ בחר הכל (${products.length})`}
          </button>
        )}
      </div>

      {/* Bulk Actions Bar — visible when items are selected */}
      {selectedIds.size > 0 && (
        <div className="glass-card" style={{ padding: '1rem 2rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '1.5rem', background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.3)' }}>
          <span style={{ color: 'var(--accent-blue)', fontWeight: 600, fontSize: '0.95rem' }}>
            {selectedIds.size} מוצרים נבחרו
          </span>
          <button
            className={`btn btn-primary ${isBulkProcessing ? 'btn-disabled' : ''}`}
            disabled={isBulkProcessing}
            onClick={handleBulkPublish}
          >
            {isBulkProcessing ? 'מפרסם...' : `🚀 פרסם ${selectedIds.size} נבחרים`}
          </button>
          <button
            className={`btn btn-danger ${isBulkProcessing ? 'btn-disabled' : ''}`}
            disabled={isBulkProcessing}
            onClick={handleBulkReject}
          >
            {isBulkProcessing ? 'מוחק...' : `🗑️ מחק ${selectedIds.size} נבחרים`}
          </button>
          <button className="btn btn-secondary" onClick={() => setSelectedIds(new Set())}>
            ביטול
          </button>
        </div>
      )}

      {errorMsg && (
        <div className="glass-card" style={{ background: 'rgba(244, 63, 94, 0.08)', borderColor: 'rgba(244, 63, 94, 0.2)', color: '#f87171', padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '8px' }}>
          <strong>שגיאה: </strong>{errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '8px' }}>
          {successMsg}
        </div>
      )}

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '40vh', flexDirection: 'column', gap: '1rem' }}>
          <div className="spinner" style={{ width: '36px', height: '36px' }} />
          <span style={{ color: 'var(--text-secondary)' }}>טוען מוצרים ממתינים לתור...</span>
        </div>
      ) : products.length === 0 ? (
        <div className="glass-card" style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
          <span style={{ fontSize: '3rem', display: 'block', marginBottom: '1.5rem' }}>✨</span>
          <p style={{ fontSize: '1.25rem', fontWeight: 600, color: '#ffffff', marginBottom: '0.5rem' }}>תור האישורים ריק!</p>
          <p style={{ fontSize: '0.95rem' }}>לא נמצאו מוצרים הממתינים לסקירה בחתך הסינון הנוכחי.</p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2.5rem' }}>
          {products.map((product) => {
            const form = editForms[product.id] || { titleHe: '', bodyHe: '', bulletsHe: '', ctaHe: '' };
            const isProcessing = processingId === product.id;

            // Generate bullets JSON string on change for TelegramPreview
            const bulletsArray = form.bulletsHe.split('\n').map(b => b.trim()).filter(Boolean);
            const bulletsJsonStr = JSON.stringify(bulletsArray);

            return (
              <div key={product.id} className="glass-card" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: '2.5rem', padding: '2rem', borderColor: selectedIds.has(product.id) ? 'rgba(59, 130, 246, 0.5)' : undefined, background: selectedIds.has(product.id) ? 'rgba(59, 130, 246, 0.04)' : undefined }}>
                
                {/* Editor Content and AliExpress parameters */}
                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                  <div>
                    {/* Selection checkbox + Channel badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(product.id)}
                        onChange={() => toggleSelect(product.id)}
                        style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#3b82f6', flexShrink: 0 }}
                      />
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>בחר</span>
                    </div>

                    {/* Channel badge and AliExpress Info */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', marginBottom: '1.5rem', paddingBottom: '1rem', borderBottom: '1px solid var(--border-color)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                      <div>ערוץ יעד: <strong style={{ color: 'var(--accent-blue)' }}>{product.channel.name}</strong></div>
                      <div>AliExpress ID: <strong style={{ color: '#ffffff' }}>{product.aliexpressProductId}</strong></div>
                      <div>מחיר מבצע: <strong style={{ color: 'var(--accent-green)' }}>${product.priceDiscounted}</strong></div>
                      <div>עמלה: <strong style={{ color: 'var(--accent-amber)' }}>{product.commissionRate}%</strong></div>
                      <div>דירוג: <strong>⭐ {product.rating}</strong></div>
                      <div>מכירות: <strong>{product.salesCount}</strong></div>
                    </div>

                    <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '1.25rem', background: 'rgba(255,255,255,0.02)', padding: '0.75rem', borderRadius: '6px', borderRight: '3px solid var(--border-color)' }}>
                      <strong>כותרת מקורית (EN):</strong> {product.titleOriginal}
                    </div>

                    {/* Hebrew Copy fields Editor */}
                    <div className="form-group">
                      <label className="form-label">כותרת בעברית (Title)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        value={form.titleHe} 
                        onChange={(e) => handleInputChange(product.id, 'titleHe', e.target.value)} 
                        placeholder="הזן כותרת מושכת עם אימוג׳י אחד"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">תיאור ופרטים שיווקיים (Body)</label>
                      <textarea 
                        className="form-input" 
                        style={{ minHeight: '80px' }}
                        value={form.bodyHe} 
                        onChange={(e) => handleInputChange(product.id, 'bodyHe', e.target.value)} 
                        placeholder="2-3 משפטים בעברית שיווקית..."
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">יתרונות מוצר (Bullets - יתרון בכל שורה חדשה)</label>
                      <textarea 
                        className="form-input" 
                        style={{ minHeight: '80px' }}
                        value={form.bulletsHe} 
                        onChange={(e) => handleInputChange(product.id, 'bulletsHe', e.target.value)} 
                        placeholder="יתרון 1&#10;יתרון 2&#10;יתרון 3"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label">הנעה לפעולה וסיום (CTA)</label>
                      <input 
                        type="text" 
                        className="form-input" 
                        value={form.ctaHe} 
                        onChange={(e) => handleInputChange(product.id, 'ctaHe', e.target.value)} 
                        placeholder="משפט הנעה לפעולה עם דחיפות קלה..."
                      />
                    </div>
                  </div>

                  {/* Actions Buttons Row */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button 
                        className={`btn btn-primary ${isProcessing ? 'btn-disabled' : ''}`} 
                        disabled={isProcessing} 
                        onClick={() => handleApprove(product.id)}
                      >
                        {isProcessing ? 'מעבד...' : '✅ אשר ופרסם'}
                      </button>
                      <button 
                        className={`btn btn-secondary ${isProcessing ? 'btn-disabled' : ''}`} 
                        disabled={isProcessing} 
                        onClick={() => saveProductChanges(product.id)}
                      >
                        שמור עריכה
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                      <button 
                        className={`btn btn-secondary ${isProcessing ? 'btn-disabled' : ''}`} 
                        disabled={isProcessing} 
                        onClick={() => handleRegenerateAi(product.id)}
                        title="צור טקסט מחדש באמצעות AI"
                      >
                        🔄 שכתב עם AI
                      </button>
                      <button 
                        className={`btn btn-danger ${isProcessing ? 'btn-disabled' : ''}`} 
                        disabled={isProcessing} 
                        onClick={() => handleReject(product.id)}
                      >
                        🗑️ דחה מוצר
                      </button>
                    </div>
                  </div>
                </div>

                {/* Live Mockup Telegram Preview column */}
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem', alignSelf: 'flex-start', fontWeight: 600 }}>תצוגה מקדימה בטלגרם:</span>
                  <TelegramPreview 
                    channelName={product.channel.name}
                    imageUrl={product.imageUrl}
                    title={form.titleHe}
                    body={form.bodyHe}
                    bullets={bulletsJsonStr}
                    cta={form.ctaHe}
                    priceOriginal={product.priceOriginal}
                    priceDiscounted={product.priceDiscounted}
                    discountPercent={product.discountPercent}
                  />
                </div>

              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
