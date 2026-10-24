import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Download,
  FileText,
  FolderHeart,
  GraduationCap,
  HardDrive,
  Import,
  Map,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  BriefcaseBusiness,
  FlaskConical,
} from 'lucide-react';
import { Button } from './button';
import { Brand, LocalNote, ErrorNotice, download, errorMessage } from './shared';
import {
  defaultDatabase,
  demoProfile,
  emptyEntry,
  emptyProfile,
  entryLabels,
  personalLabels,
  sectionNames,
  type Database,
  type Profile,
  type Section,
} from '../domain/model';
import { loadDatabase, readSessionKey, saveDatabase, saveSessionKey } from '../domain/storage';
import { encryptBackup, restoreBackup } from '../domain/backup';
import { draftFromText, extractText } from '../domain/import';
import { endpointUrl } from '../ai/client';

const personalPlaceholders: Partial<Record<keyof Profile['personal'], string>> = {
  birthday: 'YYYY-MM-DD',
  city: '例如：杭州市',
  highestEducation: '例如：本科、硕士研究生',
  studyMode: '例如：全日制、非全日制',
  householdLocation: '例如：浙江省杭州市',
  ethnicity: '例如：汉族',
};

type View = 'profile' | 'import' | 'mappings' | 'settings';
function ProfileEditor({ value, onChange }: { value: Profile; onChange: (p: Profile) => void }) {
  function edit(section: Section, index: number, key: string, text: string) {
    onChange({
      ...value,
      [section]: value[section].map((entry, i) =>
        i === index ? { ...entry, [key]: text } : entry,
      ),
    });
  }
  return (
    <>
      <section className="card">
        <div className="section-heading">
          <h2>
            <FileText size={19} /> 基本资料
          </h2>
          <span className="tag">只填写你需要的内容</span>
        </div>
        <div className="form-grid">
          {Object.entries(personalLabels).map(([key, label]) => (
            <label
              key={key}
              className={['summary', 'skills', 'awards'].includes(key) ? 'full' : ''}
            >
              {label}
              {['summary', 'skills', 'awards'].includes(key) ? (
                <textarea
                  value={value.personal[key as keyof Profile['personal']]}
                  rows={key === 'summary' ? 3 : 2}
                  onChange={(e) =>
                    onChange({ ...value, personal: { ...value.personal, [key]: e.target.value } })
                  }
                />
              ) : (
                <input
                  value={value.personal[key as keyof Profile['personal']]}
                  placeholder={personalPlaceholders[key as keyof Profile['personal']] || ''}
                  onChange={(e) =>
                    onChange({ ...value, personal: { ...value.personal, [key]: e.target.value } })
                  }
                />
              )}
            </label>
          ))}
        </div>
      </section>
      {(Object.entries(sectionNames) as [Section, string][]).map(([section, title]) => (
        <section className="card" key={section}>
          <div className="section-heading">
            <h2>
              {section === 'education' ? (
                <GraduationCap size={19} />
              ) : section === 'experience' ? (
                <BriefcaseBusiness size={19} />
              ) : (
                <FolderHeart size={19} />
              )}
              {title}
            </h2>
            <Button
              variant="secondary"
              onClick={() => onChange({ ...value, [section]: [...value[section], emptyEntry()] })}
            >
              <Plus size={15} />
              添加经历
            </Button>
          </div>
          {!value[section].length && (
            <div className="inline-empty">每一段经历，都值得被好好记录。</div>
          )}
          {value[section].map((entry, index) => (
            <div className="entry-card" key={entry.id}>
              <div className="entry-top">
                <span>经历 {String(index + 1).padStart(2, '0')}</span>
                <Button
                  variant="ghost"
                  aria-label={`删除${title}${index + 1}`}
                  onClick={() =>
                    onChange({ ...value, [section]: value[section].filter((_, i) => i !== index) })
                  }
                >
                  <Trash2 size={15} />
                </Button>
              </div>
              <div className="form-grid">
                {Object.entries(entryLabels)
                  .filter(([key]) =>
                    section === 'education' ? key !== 'role' : !['major', 'degree'].includes(key),
                  )
                  .map(([key, label]) => (
                    <label key={key} className={key === 'description' ? 'full' : ''}>
                      {key === 'organization'
                        ? section === 'education'
                          ? '学校名称'
                          : section === 'experience'
                            ? '公司名称'
                            : '项目名称'
                        : label}
                      {key === 'description' ? (
                        <textarea
                          rows={3}
                          value={entry.description}
                          onChange={(e) => edit(section, index, key, e.target.value)}
                        />
                      ) : (
                        <input
                          placeholder={
                            ['start', 'end'].includes(key) ? 'YYYY-MM 或 YYYY-MM-DD' : ''
                          }
                          value={entry[key as keyof typeof entry]}
                          onChange={(e) => edit(section, index, key, e.target.value)}
                        />
                      )}
                    </label>
                  ))}
              </div>
            </div>
          ))}
        </section>
      ))}
      <section className="card">
        <div className="section-heading">
          <h2>
            <Plus size={19} /> 自定义资料
          </h2>
          <Button
            variant="secondary"
            onClick={() =>
              onChange({
                ...value,
                custom: [...value.custom, { id: crypto.randomUUID(), label: '新字段', value: '' }],
              })
            }
          >
            添加字段
          </Button>
        </div>
        {value.custom.map((c, i) => (
          <div className="custom-row" key={c.id}>
            <input
              aria-label={`字段名 ${i + 1}`}
              value={c.label}
              onChange={(e) =>
                onChange({
                  ...value,
                  custom: value.custom.map((v) =>
                    v.id === c.id ? { ...v, label: e.target.value } : v,
                  ),
                })
              }
            />
            <input
              aria-label={`字段值 ${i + 1}`}
              value={c.value}
              onChange={(e) =>
                onChange({
                  ...value,
                  custom: value.custom.map((v) =>
                    v.id === c.id ? { ...v, value: e.target.value } : v,
                  ),
                })
              }
            />
            <Button
              variant="ghost"
              aria-label={`删除字段 ${i + 1}`}
              onClick={() =>
                onChange({ ...value, custom: value.custom.filter((v) => v.id !== c.id) })
              }
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
      </section>
    </>
  );
}

export function Dashboard() {
  const [db, setDb] = useState<Database>();
  const [profile, setProfile] = useState<Profile>();
  const [view, setView] = useState<View>('profile');
  const [demo, setDemo] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [password, setPassword] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [timeoutDraft, setTimeoutDraft] = useState('30');
  useEffect(() => {
    setTimeoutDraft(String(db?.settings.timeoutSeconds ?? 30));
  }, [db?.settings.timeoutSeconds]);
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<Profile>();
  useEffect(() => {
    loadDatabase()
      .then((d) => {
        setDb(d);
        setProfile(d.profiles.find((p) => p.id === d.activeId));
      })
      .catch((e) => setMessage(errorMessage(e)));
    readSessionKey()
      .then(setApiKey)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      setMessage(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  async function saveProfile() {
    if (!profile || demo) return;
    const latest = await loadDatabase();
    latest.profiles = latest.profiles.map((p) => (p.id === profile.id ? profile : p));
    latest.activeId = profile.id;
    await saveDatabase(latest);
    setDb(latest);
    setDirty(false);
    setMessage('已保存在这台设备');
  }
  function canLeave(): boolean {
    return !dirty || window.confirm('当前修改尚未保存。是否放弃修改？');
  }
  function selectProfile(id: string) {
    if (!canLeave()) return;
    setDemo(false);
    setDirty(false);
    setProfile(db?.profiles.find((p) => p.id === id));
  }
  async function createProfile(copy = false) {
    if (!canLeave()) return;
    const p =
      copy && profile
        ? { ...structuredClone(profile), id: crypto.randomUUID(), name: `${profile.name} · 副本` }
        : emptyProfile('新的岗位版本');
    const latest = await loadDatabase();
    latest.profiles.push(p);
    latest.activeId = p.id;
    await saveDatabase(latest);
    setDb(latest);
    setProfile(p);
    setDemo(false);
    setDirty(false);
    setView('profile');
  }
  const navigation: { id: View; title: string; icon: typeof FileText }[] = [
    { id: 'profile', title: '我的简历', icon: FileText },
    { id: 'import', title: '导入资料', icon: Import },
    { id: 'mappings', title: '填写记忆', icon: Map },
    { id: 'settings', title: '数据与设置', icon: Settings2 },
  ];
  return (
    <div className="dashboard">
      <aside className="sidebar">
        <Brand />
        <div className="workspace-label">
          我的求职空间 <span>LOCAL</span>
        </div>
        <nav>
          {navigation.map((n) => (
            <button
              className={view === n.id ? 'nav-item active' : 'nav-item'}
              key={n.id}
              onClick={() => setView(n.id)}
            >
              <n.icon size={18} />
              {n.title}
              {view === n.id && <ChevronRight size={15} />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <ShieldCheck size={23} />
          <strong>你的经历，由你掌握。</strong>
          <p>
            免账号，资料本地保存。
            <br />
            每一次填写都由你确认。
          </p>
        </div>
        <button
          className="demo-toggle"
          onClick={() => {
            if (!canLeave()) return;
            setDemo(!demo);
            setProfile(demo ? db?.profiles.find((p) => p.id === db.activeId) : demoProfile());
            setDirty(false);
            setView('profile');
          }}
        >
          <FlaskConical size={16} />
          {demo ? '退出演示模式' : '看看虚构演示'}
        </button>
        <div className="version">开源预览版 · v{browser.runtime.getManifest().version}</div>
      </aside>
      <div className="workspace">
        <header className="workspace-top">
          <span>
            工作空间 <ChevronRight size={13} /> {navigation.find((n) => n.id === view)?.title}
          </span>
          <LocalNote />
        </header>
        <main className="workspace-main">
          <div className="page-title">
            <div>
              <div className="eyebrow">YOUR NEXT CHAPTER</div>
              <h1>
                {view === 'profile'
                  ? '让经历，随时就绪。'
                  : view === 'import'
                    ? '从已有的简历开始。'
                    : view === 'mappings'
                      ? '一次修正，下次记得。'
                      : '安心保存，自主选择。'}
              </h1>
              <p>
                {view === 'profile'
                  ? '认真写过的每一段经历，不必重复输入。'
                  : view === 'import'
                    ? '文件在设备上提取，核对后再保存到资料库。'
                    : view === 'mappings'
                      ? '你在填写预览中确认的字段对应关系，只保存在本机。'
                      : '管理备份、可选 AI 和这台设备上的资料。'}
              </p>
            </div>
            <span className="edition">
              LOCAL FIRST
              <br />
              <strong>为下一次机会准备</strong>
            </span>
          </div>
          <ErrorNotice message={message} />
          {demo && (
            <div className="demo-banner">
              <FlaskConical size={18} />
              正在查看虚构演示，编辑不会覆盖真实资料。
            </div>
          )}
          {!db || !profile ? (
            <div className="card">
              正在读取本地资料… 若读取失败，请保留错误信息，勿清除扩展数据。
            </div>
          ) : (
            <>
              {view === 'profile' && (
                <>
                  <div className="profile-toolbar">
                    <div>
                      <label htmlFor="profile-version">简历版本</label>
                      <select
                        id="profile-version"
                        value={demo ? 'demo' : profile.id}
                        disabled={demo || busy}
                        onChange={(e) => selectProfile(e.target.value)}
                      >
                        {demo ? (
                          <option value="demo">虚构演示</option>
                        ) : (
                          db.profiles.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))
                        )}
                      </select>
                    </div>
                    <div className="toolbar-actions">
                      <Button
                        variant="secondary"
                        disabled={busy || demo}
                        onClick={() => void run(() => createProfile())}
                      >
                        <Plus size={16} />
                        新版本
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy || demo}
                        onClick={() => void run(() => createProfile(true))}
                      >
                        <Copy size={16} />
                        复制
                      </Button>
                      <Button disabled={busy || demo} onClick={() => void run(saveProfile)}>
                        <Check size={16} />
                        {dirty ? '保存修改' : '保存资料'}
                      </Button>
                    </div>
                  </div>
                  <div className="editor-layout">
                    <div>
                      <section className="card compact">
                        <label>
                          版本名称
                          <input
                            value={profile.name}
                            onChange={(e) => {
                              setProfile({ ...profile, name: e.target.value });
                              setDirty(true);
                            }}
                          />
                        </label>
                      </section>
                      <ProfileEditor
                        value={profile}
                        onChange={(p) => {
                          setProfile(p);
                          if (!demo) setDirty(true);
                        }}
                      />
                    </div>
                    <aside className="editor-aside">
                      <div className="tip-card">
                        <span className="tip-icon">
                          <BookOpen size={20} />
                        </span>
                        <h3>
                          资料完整一点，
                          <br />
                          填写就轻松一点。
                        </h3>
                        <p>不同岗位，可以保留不同版本。选择一份资料，再打开企业的网申页面。</p>
                        <div className="tip-rule" />
                        <span className="mini-label">填写前的小提示</span>
                        <p>日期可填写到月份。网页要求具体日期时，会留给你确认。</p>
                        <p>多段经历按资料中的顺序匹配，请先在网页展开对应的经历区域。</p>
                      </div>
                      <Button
                        variant="ghost"
                        disabled={busy || demo || db.profiles.length < 2}
                        onClick={() =>
                          void run(async () => {
                            if (!confirm('删除当前简历版本？此操作无法撤销。')) return;
                            const latest = await loadDatabase();
                            latest.profiles = latest.profiles.filter((p) => p.id !== profile.id);
                            latest.activeId = latest.profiles[0]!.id;
                            await saveDatabase(latest);
                            setDb(latest);
                            setProfile(latest.profiles[0]);
                            setDirty(false);
                          })
                        }
                      >
                        <Trash2 size={14} />
                        删除这个版本
                      </Button>
                    </aside>
                  </div>
                </>
              )}
              {view === 'import' && (
                <>
                  <section className="card">
                    <div className="section-heading">
                      <h2>
                        <Import size={19} /> 本地提取文本
                      </h2>
                      <span className="tag">PDF / DOCX / TXT</span>
                    </div>
                    <label className="upload-zone">
                      <Import size={27} />
                      <strong>选择你的简历文件</strong>
                      <span>文本型文件，最大 10 MB；不上传原文件</span>
                      <input
                        aria-label="导入简历文件"
                        type="file"
                        accept=".pdf,.docx,.txt"
                        disabled={busy}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file)
                            void run(async () => {
                              const extracted = await extractText(file);
                              setText(extracted);
                              setDraft(draftFromText(extracted));
                              setMessage(
                                '已在本地提取文本。基础解析仅识别联系方式等，请补全并核对经历',
                              );
                            });
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <label>
                      也可以粘贴文本
                      <textarea
                        value={text}
                        rows={8}
                        maxLength={100000}
                        onChange={(e) => {
                          setText(e.target.value);
                        }}
                      />
                    </label>
                    <div className="button-row">
                      <Button
                        variant="secondary"
                        disabled={!text || busy}
                        onClick={() => setDraft(draftFromText(text))}
                      >
                        生成本地基础草稿
                      </Button>
                    </div>
                  </section>
                  {draft && (
                    <>
                      <div className="section-heading">
                        <h2>核对导入草稿</h2>
                        <Button
                          disabled={busy || demo}
                          onClick={() =>
                            void run(async () => {
                              if (!canLeave()) return;
                              const latest = await loadDatabase();
                              latest.profiles.push(draft);
                              latest.activeId = draft.id;
                              await saveDatabase(latest);
                              setDb(latest);
                              setProfile(draft);
                              setDraft(undefined);
                              setText('');
                              setView('profile');
                              setDirty(false);
                              setMessage('已保存为新的简历版本');
                            })
                          }
                        >
                          确认并保存为新版本
                        </Button>
                      </div>
                      <ProfileEditor value={draft} onChange={setDraft} />
                    </>
                  )}
                </>
              )}
              {view === 'mappings' && (
                <section className="card">
                  <div className="section-heading">
                    <h2>
                      <Map size={19} /> 已记住的字段{' '}
                      <span className="count">{db.mappings.length}</span>
                    </h2>
                    <Button
                      variant="secondary"
                      disabled={busy || demo}
                      onClick={() => void run(async () => setDb(await loadDatabase()))}
                    >
                      刷新
                    </Button>
                  </div>
                  {!db.mappings.length && (
                    <div className="inline-empty">
                      在插件填写预览中重新选择字段对应资料，就会出现在这里。
                    </div>
                  )}
                  {db.mappings.map((m, i) => (
                    <div className="mapping-row" key={`${m.origin}-${m.signature}`}>
                      <div>
                        <strong>{m.label}</strong>
                        <small>{m.origin}</small>
                        <code>{m.path}</code>
                      </div>
                      <Button
                        variant="ghost"
                        disabled={busy || demo}
                        aria-label={`删除映射 ${i + 1}`}
                        onClick={() =>
                          void run(async () => {
                            const latest = await loadDatabase();
                            latest.mappings = latest.mappings.filter(
                              (v) => !(v.origin === m.origin && v.signature === m.signature),
                            );
                            await saveDatabase(latest);
                            setDb(latest);
                          })
                        }
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  ))}
                </section>
              )}
              {view === 'settings' && (
                <>
                  <section className="card">
                    <div className="section-heading">
                      <h2>
                        <HardDrive size={19} /> 备份与恢复
                      </h2>
                      <span className="tag">仅保存在本机</span>
                    </div>
                    <p className="muted">
                      卸载插件会清除本地资料。普通资料库不是加密保险箱，请定期导出加密备份。忘记备份密码将无法恢复。
                    </p>
                    <label>
                      备份密码
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="至少 8 个字符"
                      />
                    </label>
                    <div className="button-row">
                      <Button
                        disabled={busy || demo}
                        onClick={() =>
                          void run(async () => {
                            download(
                              'resume-companion.encrypted.json',
                              await encryptBackup(await loadDatabase(), password),
                            );
                            setPassword('');
                            setMessage('加密备份已导出，请妥善保存密码');
                          })
                        }
                      >
                        <Download size={16} />
                        导出加密备份
                      </Button>
                      <label className="button button-secondary">
                        导入备份
                        <input
                          className="file-hidden"
                          type="file"
                          accept=".json"
                          disabled={busy || demo}
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file)
                              void run(async () => {
                                const restored = await restoreBackup(await file.text(), password);
                                if (
                                  !confirm(
                                    `恢复 ${restored.profiles.length} 份简历，将替换当前全部资料与映射。继续？`,
                                  )
                                )
                                  return;
                                await saveDatabase(restored);
                                await saveSessionKey('');
                                setApiKey('');
                                setDb(restored);
                                setProfile(
                                  restored.profiles.find((p) => p.id === restored.activeId),
                                );
                                setPassword('');
                                setDirty(false);
                                setMessage('备份已恢复；AI 密钥需要重新输入');
                              });
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                    <p className="muted">
                      支持当前加密备份和符合公开 schema 的 JSON 数据导入。备份不含 API Key。
                    </p>
                  </section>
                  <section className="card">
                    <div className="section-heading">
                      <h2>
                        <Sparkles size={19} /> 可选 AI
                      </h2>
                      <label className="check-row">
                        <input
                          type="checkbox"
                          checked={db.settings.aiEnabled}
                          disabled={demo}
                          onChange={(e) =>
                            setDb({
                              ...db,
                              settings: { ...db.settings, aiEnabled: e.target.checked },
                            })
                          }
                        />
                        启用
                      </label>
                    </div>
                    <p className="muted">
                      默认关闭。AI 根据页面文字与控件布局匹配资料
                      key，不发送填写内容。先预览请求，再点击“确认识别并填写”，插件会在本地取值并自动填写有效匹配项；不确定项会跳过。使用你自己的服务与额度；密钥仅保留在浏览器会话，关闭浏览器后重新输入。
                    </p>
                    <div className="form-grid">
                      <label>
                        API 基础地址
                        <input
                          placeholder="https://your-provider.example/v1"
                          value={db.settings.endpoint}
                          onChange={(e) =>
                            setDb({ ...db, settings: { ...db.settings, endpoint: e.target.value } })
                          }
                        />
                      </label>
                      <label>
                        模型名称
                        <input
                          value={db.settings.model}
                          onChange={(e) =>
                            setDb({ ...db, settings: { ...db.settings, model: e.target.value } })
                          }
                        />
                      </label>
                      <label>
                        AI 等待方式
                        <select
                          value={db.settings.timeoutSeconds === null ? 'unlimited' : 'limited'}
                          onChange={(e) =>
                            setDb({
                              ...db,
                              settings: {
                                ...db.settings,
                                timeoutSeconds: e.target.value === 'unlimited' ? null : 30,
                              },
                            })
                          }
                        >
                          <option value="limited">自定义等待时长</option>
                          <option value="unlimited">无限等待</option>
                        </select>
                      </label>
                      {db.settings.timeoutSeconds !== null && (
                        <label>
                          最长等待时间（秒）
                          <input
                            type="number"
                            min={1}
                            max={86400}
                            step={1}
                            value={timeoutDraft}
                            onChange={(e) => setTimeoutDraft(e.target.value)}
                          />
                          <span className="muted">
                            默认 30 秒，可设为 120、300 等，范围 1–86400 秒。
                          </span>
                        </label>
                      )}
                      <p className="muted full">
                        无限等待时插件不设超时，可在侧栏取消；服务商或网络仍可能中断请求。
                      </p>
                      <label className="full">
                        本次会话 API Key
                        <input
                          type="password"
                          autoComplete="off"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                        />
                      </label>
                    </div>
                    <Button
                      disabled={busy || demo}
                      onClick={() =>
                        void run(async () => {
                          if (db.settings.aiEnabled) {
                            endpointUrl(db.settings.endpoint);
                            if (!db.settings.model.trim()) throw new Error('请输入模型名称');
                          }
                          const latest = await loadDatabase();
                          const timeoutSeconds =
                            db.settings.timeoutSeconds === null ? null : Number(timeoutDraft);
                          if (
                            timeoutSeconds !== null &&
                            (!Number.isInteger(timeoutSeconds) ||
                              timeoutSeconds < 1 ||
                              timeoutSeconds > 86400)
                          )
                            throw new Error('等待时长请输入 1–86400 秒的整数，或选择无限等待');
                          latest.settings = { ...db.settings, timeoutSeconds };
                          await saveDatabase(latest);
                          setDb(latest);
                          await saveSessionKey(db.settings.aiEnabled ? apiKey : '');
                          if (!db.settings.aiEnabled) setApiKey('');
                          setMessage('设置已保存');
                        })
                      }
                    >
                      保存 AI 设置
                    </Button>
                  </section>
                  <section className="card">
                    <h2>站点权限</h2>
                    <p className="muted">
                      通过浏览器扩展详情页可撤回站点访问权限。当前页访问由你点击开启，AI
                      服务权限仅在确认请求时申请。
                    </p>
                    <p>适配状态：通用引擎与三类系统的实验适配。真实企业页面验证尚待完成。</p>
                  </section>
                  <section className="card danger-zone">
                    <h2>清空本机数据</h2>
                    <p className="muted">删除所有简历、字段记忆与设置，无法撤销。先导出备份。</p>
                    <Button
                      variant="danger"
                      disabled={busy || demo}
                      onClick={() =>
                        void run(async () => {
                          if (prompt('输入“清空资料”确认删除全部本机数据') !== '清空资料') return;
                          const fresh = defaultDatabase();
                          await browser.storage.local.clear();
                          await browser.storage.session.clear();
                          await saveDatabase(fresh);
                          setDb(fresh);
                          setProfile(fresh.profiles[0]);
                          setApiKey('');
                          setDirty(false);
                          setMessage('本机资料已清空');
                        })
                      }
                    >
                      <Trash2 size={16} />
                      清空所有资料
                    </Button>
                  </section>
                </>
              )}
            </>
          )}
          <footer className="workspace-footer">
            <span>每一段认真准备的经历，都值得被看见。</span>
            <span>
              Resume Companion <ArrowUpRight size={13} />
            </span>
          </footer>
        </main>
      </div>
    </div>
  );
}
