// src/app/settings/page.tsx
'use client';

import { useState, useEffect } from 'react';

type Channel = {
  id: string;
  name: string;
  telegramChatId: string;
  botToken: string;
  categories: string; // JSON array string
  isActive: boolean;
  autoPublish: boolean;
  publishIntervalHours: number;
  lastPublishedAt: string | null;
  createdAt: string;
};

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<'connections' | 'channels' | 'rules' | 'template'>('connections');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Global settings state
  const [settings, setSettings] = useState<Record<string, string>>({
    aliexpress_app_key: '',
    aliexpress_app_secret: '',
    aliexpress_tracking_id: '',
    gemini_api_key: '',
    ai_system_prompt: '',
    ai_post_template: '',
    min_commission_rate: '5',
    min_rating: '4.5',
    min_sales: '100',
    dedup_days: '30',
    bot_active: 'true',
  });

  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [showChannelModal, setShowChannelModal] = useState(false);
  const [editingChannel, setEditingChannel] = useState<Partial<Channel> | null>(null);

  // Category input helper (shows as comma-separated string)
  const [categoryInput, setCategoryInput] = useState('');

  // Fetch settings and channels
  const fetchData = async () => {
    try {
      setLoading(true);
      setErrorMsg(null);
      const res = await fetch('/api/settings');
      const data = await res.json();
      if (data.success) {
        setSettings((prev) => ({
          ...prev,
          ...data.settings,
        }));
        setChannels(data.channels || []);
      } else {
        setErrorMsg(data.error || 'Failed to load configuration.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'An error occurred while loading settings.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Show status success message temporarily
  const triggerSuccess = (msg: string) => {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  };

  // Handle global settings change
  const handleSettingChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  // Save Settings group (Connections, Rules, Templates)
  const saveSettings = async (keysToSave: string[]) => {
    try {
      setSaving(true);
      setErrorMsg(null);
      
      const payload: Record<string, string> = {};
      keysToSave.forEach((key) => {
        payload[key] = settings[key] || '';
      });

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'settings',
          data: payload,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('ההגדרות נשמרו בהצלחה בקבוצת מסד הנתונים ✅');
      } else {
        setErrorMsg(data.error || 'שמירת ההגדרות נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בשמירת הגדרות.');
    } finally {
      setSaving(false);
    }
  };

  // Open channel modal for create
  const handleAddChannelClick = () => {
    setEditingChannel({
      name: '',
      telegramChatId: '',
      botToken: '',
      isActive: true,
      autoPublish: false,
      publishIntervalHours: 6,
    });
    setCategoryInput('');
    setShowChannelModal(true);
  };

  // Open channel modal for edit
  const handleEditChannelClick = (channel: Channel) => {
    setEditingChannel(channel);
    try {
      const parsed = JSON.parse(channel.categories);
      setCategoryInput(Array.isArray(parsed) ? parsed.join(', ') : '');
    } catch {
      setCategoryInput(channel.categories || '');
    }
    setShowChannelModal(true);
  };

  // Save channel (Create/Update)
  const handleSaveChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingChannel) return;

    // Clean categories
    const categoriesArray = categoryInput
      .split(',')
      .map((c) => c.trim())
      .filter((c) => c !== '');

    const channelData = {
      ...editingChannel,
      categories: categoriesArray,
    };

    try {
      setSaving(true);
      setErrorMsg(null);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'channel',
          data: channelData,
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('פרטי הערוץ נשמרו בהצלחה! ✅');
        setShowChannelModal(false);
        setEditingChannel(null);
        fetchData();
      } else {
        setErrorMsg(data.error || 'שמירת פרטי הערוץ נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת בשמירת ערוץ.');
    } finally {
      setSaving(false);
    }
  };

  // Quick toggle channel active state or autoPublish state from list view
  const toggleChannelParam = async (channel: Channel, param: 'isActive' | 'autoPublish') => {
    try {
      const updatedValue = !channel[param];
      let categoriesArray = [];
      try {
        categoriesArray = JSON.parse(channel.categories);
      } catch {
        categoriesArray = [channel.categories];
      }

      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'channel',
          data: {
            ...channel,
            categories: categoriesArray,
            [param]: updatedValue,
          },
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess(`מצב ${param === 'isActive' ? 'ערוץ פעיל' : 'פרסום אוטומטי'} עודכן ✅`);
        setChannels((prev) =>
          prev.map((c) => (c.id === channel.id ? { ...c, [param]: updatedValue } : c))
        );
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'עדכון מהיר נכשל.');
    }
  };

  // Delete channel
  const handleDeleteChannel = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק ערוץ זה? כל הנתונים, המוצרים והלוגים המשויכים אליו יימחקו לצמיתות.')) {
      return;
    }

    try {
      setSaving(true);
      setErrorMsg(null);
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'delete_channel',
          data: { id },
        }),
      });
      const data = await res.json();
      if (data.success) {
        triggerSuccess('הערוץ נמחק בהצלחה. 🗑️');
        setChannels((prev) => prev.filter((c) => c.id !== id));
      } else {
        setErrorMsg(data.error || 'מחיקת הערוץ נכשלה.');
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'שגיאת רשת במחיקת ערוץ.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex-center" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '80vh', flexDirection: 'column', gap: '1rem' }}>
        <div className="spinner" style={{ width: '40px', height: '40px' }} />
        <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-display)' }}>טוען הגדרות ומסד נתונים...</span>
      </div>
    );
  }

  return (
    <div className="settings-page">
      <div className="page-header" style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2.25rem', marginBottom: '0.5rem' }}>הגדרות מערכת</h1>
        <p style={{ color: 'var(--text-secondary)' }}>נהל את מפתחות ה-API, ערוצי הטלגרם, תבניות ה-AI ופרמטרים של מנוע הסינון.</p>
      </div>

      {errorMsg && (
        <div className="glass-card" style={{ background: 'rgba(244, 63, 94, 0.08)', borderColor: 'rgba(244, 63, 94, 0.2)', color: '#f87171', padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '8px', fontSize: '0.95rem' }}>
          <strong>שגיאה: </strong>{errorMsg}
        </div>
      )}

      {successMsg && (
        <div className="glass-card" style={{ background: 'rgba(16, 185, 129, 0.08)', borderColor: 'rgba(16, 185, 129, 0.2)', color: '#34d399', padding: '1rem 1.5rem', marginBottom: '1.5rem', borderRadius: '8px', fontSize: '0.95rem' }}>
          {successMsg}
        </div>
      )}

      {/* Tabs Menu */}
      <div className="tabs-header">
        <button className={`tab-btn ${activeTab === 'connections' ? 'active' : ''}`} onClick={() => setActiveTab('connections')}>
          חיבורי API ומפתחות
        </button>
        <button className={`tab-btn ${activeTab === 'channels' ? 'active' : ''}`} onClick={() => setActiveTab('channels')}>
          ערוצי טלגרם ({channels.length})
        </button>
        <button className={`tab-btn ${activeTab === 'rules' ? 'active' : ''}`} onClick={() => setActiveTab('rules')}>
          כללי סינון וסריקה
        </button>
        <button className={`tab-btn ${activeTab === 'template' ? 'active' : ''}`} onClick={() => setActiveTab('template')}>
          תבניות כתיבה ו-AI
        </button>
      </div>

      {/* Tab Panels */}
      <div className="tab-content" style={{ marginTop: '1.5rem' }}>
        
        {/* PANEL: Connections */}
        {activeTab === 'connections' && (
          <div className="glass-card">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>מפתחות וחיבורים</h3>
            
            <div className="form-group">
              <label className="form-label">AliExpress App Key</label>
              <input type="text" className="form-input" value={settings.aliexpress_app_key || ''} onChange={(e) => handleSettingChange('aliexpress_app_key', e.target.value)} placeholder="הזן מפתח שותפים של אליאקספרס" />
            </div>

            <div className="form-group">
              <label className="form-label">AliExpress App Secret</label>
              <input type="password" className="form-input" value={settings.aliexpress_app_secret || ''} onChange={(e) => handleSettingChange('aliexpress_app_secret', e.target.value)} placeholder="הזן סוד API של אליאקספרס" />
            </div>

            <div className="form-group">
              <label className="form-label">AliExpress Tracking ID (ברירת מחדל)</label>
              <input type="text" className="form-input" value={settings.aliexpress_tracking_id || ''} onChange={(e) => handleSettingChange('aliexpress_tracking_id', e.target.value)} placeholder="default" />
            </div>

            <div className="form-group" style={{ marginTop: '2rem' }}>
              <label className="form-label">Gemini API Key</label>
              <input type="password" className="form-input" value={settings.gemini_api_key || ''} onChange={(e) => handleSettingChange('gemini_api_key', e.target.value)} placeholder="הזן מפתח AI של Gemini API" />
            </div>

            <div style={{ marginTop: '2.5rem', display: 'flex', gap: '1rem' }}>
              <button className={`btn btn-primary ${saving ? 'btn-disabled' : ''}`} disabled={saving} onClick={() => saveSettings(['aliexpress_app_key', 'aliexpress_app_secret', 'aliexpress_tracking_id', 'gemini_api_key'])}>
                {saving ? 'שומר הגדרות...' : 'שמור הגדרות חיבור'}
              </button>
            </div>
          </div>
        )}

        {/* PANEL: Channels */}
        {activeTab === 'channels' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '1.25rem', margin: 0 }}>רשימת ערוצי טלגרם מוגדרים</h3>
              <button className="btn btn-primary" onClick={handleAddChannelClick}>
                <span>+</span> הוסף ערוץ טלגרם
              </button>
            </div>

            {channels.length === 0 ? (
              <div className="glass-card" style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-secondary)' }}>
                <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>לא נמצאו ערוצים מוגדרים במערכת.</p>
                <button className="btn btn-secondary" onClick={handleAddChannelClick}>צור את ערוץ הטלגרם הראשון</button>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: '1.5rem' }}>
                {channels.map((channel) => (
                  <div key={channel.id} className="glass-card" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <h4 style={{ fontSize: '1.15rem', color: '#ffffff' }}>{channel.name}</h4>
                        <span className={`badge ${channel.isActive ? 'badge-success' : 'badge-danger'}`}>
                          {channel.isActive ? 'פעיל' : 'מושהה'}
                        </span>
                      </div>

                      <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                        <div><strong>מזהה צ׳אט:</strong> <span style={{ fontFamily: 'monospace' }}>{channel.telegramChatId}</span></div>
                        <div>
                          <strong>קטגוריות AliExpress:</strong>{' '}
                          {(() => {
                            try {
                              const parsed = JSON.parse(channel.categories);
                              return Array.isArray(parsed) && parsed.length > 0 ? (
                                <span style={{ background: 'rgba(255,255,255,0.05)', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', fontFamily: 'monospace' }}>
                                  {parsed.join(', ')}
                                </span>
                              ) : (
                                <span style={{ color: 'var(--accent-pink)' }}>אין קטגוריות מוגדרות</span>
                              );
                            } catch {
                              return <span style={{ fontFamily: 'monospace' }}>{channel.categories}</span>;
                            }
                          })()}
                        </div>
                        <div><strong>מרווח פרסום:</strong> כל {channel.publishIntervalHours} שעות</div>
                        {channel.lastPublishedAt && (
                          <div><strong>פרסום אחרון:</strong> {new Date(channel.lastPublishedAt).toLocaleString('he-IL')}</div>
                        )}
                      </div>
                    </div>

                    <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '1rem', marginTop: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', gap: '0.75rem' }}>
                        {/* Auto-publish toggle button */}
                        <div className={`toggle-container ${channel.autoPublish ? 'toggle-active' : ''}`} onClick={() => toggleChannelParam(channel, 'autoPublish')}>
                          <div className="toggle-switch" style={{ width: '38px', height: '20px' }} />
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>פרסום אוטומטי</span>
                        </div>
                      </div>

                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => handleEditChannelClick(channel)}>
                          ערוך
                        </button>
                        <button className="btn btn-danger" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }} onClick={() => handleDeleteChannel(channel.id)}>
                          מחק
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PANEL: Scan Rules */}
        {activeTab === 'rules' && (
          <div className="glass-card">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>חוקי סריקה וסינון מוצרים</h3>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <div className="toggle-container" onClick={() => handleSettingChange('bot_active', settings.bot_active === 'true' ? 'false' : 'true')}>
                <div className={`toggle-switch ${settings.bot_active === 'true' ? 'toggle-active' : ''}`} style={{ width: '46px', height: '24px' }} />
                <span className="form-label" style={{ margin: 0, fontSize: '1rem', color: '#ffffff' }}>מנוע אוטומציה סורק פעיל (Bot Scan Engine)</span>
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.4rem', marginRight: '3.5rem' }}>
                כאשר מופעל, משימות Cron יסרקו מוצרים ויפרסמו אוטומטית. כאשר כבוי, מנוע הסריקה הראשי מושבת לחלוטין.
              </p>
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <div className="slider-container">
                <div className="slider-info">
                  <span>עמלת שותפים מינימלית (Commission Rate)</span>
                  <span className="slider-val">{settings.min_commission_rate}%</span>
                </div>
                <input type="range" min="1" max="25" step="1" className="slider-input" value={settings.min_commission_rate || '5'} onChange={(e) => handleSettingChange('min_commission_rate', e.target.value)} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <div className="slider-container">
                <div className="slider-info">
                  <span>דירוג מוצר מינימלי (Rating 1-5)</span>
                  <span className="slider-val">{settings.min_rating}</span>
                </div>
                <input type="range" min="1" max="5" step="0.1" className="slider-input" value={settings.min_rating || '4.5'} onChange={(e) => handleSettingChange('min_rating', e.target.value)} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <div className="slider-container">
                <div className="slider-info">
                  <span>כמות מכירות מינימלית של מוצר (Sales Count)</span>
                  <span className="slider-val">{settings.min_sales} מכירות</span>
                </div>
                <input type="range" min="10" max="1000" step="10" className="slider-input" value={settings.min_sales || '100'} onChange={(e) => handleSettingChange('min_sales', e.target.value)} />
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: '2rem' }}>
              <div className="slider-container">
                <div className="slider-info">
                  <span>ימי מניעת כפילויות מוצר (Deduplication Protection Window)</span>
                  <span className="slider-val">{settings.dedup_days} ימים</span>
                </div>
                <input type="range" min="1" max="90" step="1" className="slider-input" value={settings.dedup_days || '30'} onChange={(e) => handleSettingChange('dedup_days', e.target.value)} />
              </div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.3rem' }}>
                מונע העלאת מוצרים מאליאקספרס שכבר פורסמו בערוץ זה במהלך כמות הימים שנבחרה.
              </p>
            </div>

            <div style={{ marginTop: '2.5rem' }}>
              <button className={`btn btn-primary ${saving ? 'btn-disabled' : ''}`} disabled={saving} onClick={() => saveSettings(['bot_active', 'min_commission_rate', 'min_rating', 'min_sales', 'dedup_days'])}>
                {saving ? 'שומר חוקי סריקה...' : 'שמור חוקי סריקה'}
              </button>
            </div>
          </div>
        )}

        {/* PANEL: AI Template */}
        {activeTab === 'template' && (
          <div className="glass-card">
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>תבניות AI והנחיות ל-Gemini</h3>

            <div className="form-group">
              <label className="form-label">הנחיות מערכת לכותב ה-AI (System Prompt)</label>
              <textarea className="form-input" style={{ minHeight: '160px' }} value={settings.ai_system_prompt || ''} onChange={(e) => handleSettingChange('ai_system_prompt', e.target.value)} placeholder="הנחיות התנהגות למודל Gemini לתרגום וכתיבה שיווקית..." />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                הגדר את הטון השיווקי, הגבלות כתיבה (למשל JSON בלבד), וסגנון הטקסט שייכתב בעברית.
              </p>
            </div>

            <div className="form-group" style={{ marginTop: '2rem' }}>
              <label className="form-label">תבנית עיצוב פוסט סופי בטלגרם (Post Template)</label>
              <textarea className="form-input" style={{ minHeight: '140px' }} value={settings.ai_post_template || ''} onChange={(e) => handleSettingChange('ai_post_template', e.target.value)} placeholder="לדוגמה:
*{title}*
{body}
✅ {bullet1}
...
" />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '0.4rem' }}>
                מבנה הודעת הטלגרם. השתמש במאקרו-משתנים שיורכבו דינמית בפרסום.
              </p>
            </div>

            <div style={{ marginTop: '2.5rem' }}>
              <button className={`btn btn-primary ${saving ? 'btn-disabled' : ''}`} disabled={saving} onClick={() => saveSettings(['ai_system_prompt', 'ai_post_template'])}>
                {saving ? 'שומר תבניות AI...' : 'שמור תבניות כתיבה'}
              </button>
            </div>
          </div>
        )}

      </div>

      {/* CHANNEL MODAL */}
      {showChannelModal && editingChannel && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0, 0, 0, 0.75)', backdropFilter: 'blur(8px)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1000 }}>
          <div className="glass-card" style={{ width: '90%', maxWidth: '550px', background: 'var(--bg-secondary)', border: '1px solid rgba(255,255,255,0.15)' }}>
            <h3 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', color: '#ffffff' }}>
              {editingChannel.id ? 'עריכת ערוץ טלגרם' : 'הוספת ערוץ טלגרם חדש'}
            </h3>

            <form onSubmit={handleSaveChannel}>
              <div className="form-group">
                <label className="form-label">שם הערוץ (לזיהוי פנימי במערכת)</label>
                <input type="text" required className="form-input" value={editingChannel.name || ''} onChange={(e) => setEditingChannel((prev) => ({ ...prev, name: e.target.value }))} placeholder="למשל: אלי אקספרס - דילים חמים" />
              </div>

              <div className="form-group">
                <label className="form-label">Telegram Chat ID (מזהה ערוץ בטלגרם)</label>
                <input type="text" required className="form-input" value={editingChannel.telegramChatId || ''} onChange={(e) => setEditingChannel((prev) => ({ ...prev, telegramChatId: e.target.value }))} placeholder="למשל: -100123456789 או @mychannel" />
              </div>

              <div className="form-group">
                <label className="form-label">Bot Token (קוד גישה של בוט הטלגרם)</label>
                <input type="password" required className="form-input" value={editingChannel.botToken || ''} onChange={(e) => setEditingChannel((prev) => ({ ...prev, botToken: e.target.value }))} placeholder="הזן את הטוקן שקיבלת מ-BotFather" />
              </div>

              <div className="form-group">
                <label className="form-label">קטגוריות אליאקספרס (מופרדות בפסיק)</label>
                <input type="text" className="form-input" value={categoryInput} onChange={(e) => setCategoryInput(e.target.value)} placeholder="לדוגמה: 509, 1501, 200000343" />
                <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                  מזהי קטגוריות רשמיים של AliExpress לסריקה (מזהי מספרים בלבד).
                </p>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.25rem', marginBottom: '1.5rem' }}>
                <div className="toggle-container" onClick={() => setEditingChannel((prev) => prev ? { ...prev, autoPublish: !prev.autoPublish } : null)}>
                  <div className={`toggle-switch ${editingChannel.autoPublish ? 'toggle-active' : ''}`} style={{ width: '38px', height: '20px' }} />
                  <span style={{ fontSize: '0.85rem' }}>פרסום אוטומטי</span>
                </div>

                <div className="toggle-container" onClick={() => setEditingChannel((prev) => prev ? { ...prev, isActive: !prev.isActive } : null)}>
                  <div className={`toggle-switch ${editingChannel.isActive ? 'toggle-active' : ''}`} style={{ width: '38px', height: '20px' }} />
                  <span style={{ fontSize: '0.85rem' }}>ערוץ פעיל</span>
                </div>
              </div>

              <div className="form-group" style={{ marginBottom: '2rem' }}>
                <div className="slider-container">
                  <div className="slider-info">
                    <span>מרווח זמן לפרסום סדרתי (שעות)</span>
                    <span className="slider-val">{editingChannel.publishIntervalHours} שעות</span>
                  </div>
                  <input type="range" min="1" max="24" step="1" className="slider-input" value={editingChannel.publishIntervalHours || 6} onChange={(e) => setEditingChannel((prev) => prev ? { ...prev, publishIntervalHours: Number(e.target.value) } : null)} />
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1.25rem' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setShowChannelModal(false)}>
                  ביטול
                </button>
                <button type="submit" className={`btn btn-primary ${saving ? 'btn-disabled' : ''}`} disabled={saving}>
                  {saving ? 'שומר ערוץ...' : 'שמור ערוץ'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
