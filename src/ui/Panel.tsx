import { useEffect, useMemo, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  ArrowUpRight,
  ScanLine,
  RotateCcw,
  Check,
  CircleHelp,
  Sparkles,
  Settings2,
  MousePointer2,
} from 'lucide-react';
import { Button } from './button';
import { Brand, LocalNote, ErrorNotice, errorMessage, download } from './shared';
import { facts, demoProfile, type Database, type Profile } from '../domain/model';
import { addMissingFields, type Supplement } from '../domain/missing-fields';
import { loadDatabase, saveDatabase, readSessionKey, updateTemplates } from '../domain/storage';
import { createTemplate, resolveTemplates, type TemplateResolution } from '../engine/templates';
import { matchField } from '../engine/matcher';
import type { FillResult, PlanItem, Scan, LayoutScan } from '../engine/types';
import { endpointUrl } from '../ai/client';
import {
  prepareLayoutRequest,
  prepareIncrementalRequest,
  selectLayoutRegion,
  requestLayoutMappings,
  resolveLayoutPlan,
} from '../ai/layout';

type AIStage =
  | 'template'
  | 'idle'
  | 'collecting'
  | 'confirmation'
  | 'recognizing'
  | 'filling'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'stale';
const stageLabels: Record<AIStage, string> = {
  template: '本地模板预览',
  idle: '准备识别',
  collecting: '采集中',
  confirmation: '等待确认发送',
  recognizing: 'AI 识别中',
  filling: '本地填写中',
  complete: '完成',
  failed: '失败',
  cancelled: '已取消',
  stale: '页面或资料已变化',
};
const stageDetails: Record<AIStage, string> = {
  template: '已在本地检查模板；无需向 AI 发送已复用字段。',
  idle: '',
  collecting: '正在本地采集页面文字与控件，尚未发送给 AI。',
  confirmation: '尚未发送给 AI，请检查发送预览并确认发送。',
  recognizing: '正在等待 AI 返回字段识别结果。',
  filling: '识别结果已返回，正在本地检查并填写。',
  complete: '识别已结束，请核对各字段结果。',
  failed: '本次操作未完成，请查看原因后重新采集并识别。',
  cancelled: '已停止等待，未执行本次填写；可重新采集并识别。',
  stale: '旧结果已停用，请重新采集并识别。',
};

export function Panel() {
  const [db, setDb] = useState<Database>();
  const [demo, setDemo] = useState(false);
  const [scan, setScan] = useState<Scan | LayoutScan>();
  const [tabId, setTabId] = useState<number>();
  const [plan, setPlan] = useState<PlanItem[]>([]);
  const [results, setResults] = useState<FillResult[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [aiPreview, setAiPreview] = useState(false);
  const [prepared, setPrepared] = useState<ReturnType<typeof prepareLayoutRequest>>();
  const [recognizedLabels, setRecognizedLabels] = useState<Record<string, string>>({});
  const [matchDetails, setMatchDetails] = useState<Record<string, string>>({});
  const [stage, setStage] = useState<AIStage>('idle');
  const [summary, setSummary] = useState('');
  const [reuse, setReuse] = useState<TemplateResolution>();
  const [checkedFields, setCheckedFields] = useState<string[]>([]);
  const [crossApproved, setCrossApproved] = useState(false);
  const [supplements, setSupplements] = useState<Record<string, Supplement>>({});
  const [supplementValues, setSupplementValues] = useState<Record<string, string>>({});
  const ownProfileUpdate = useRef<{ profile: string; settings: string } | undefined>(undefined);
  const revision = useRef(0);
  // Capture the learning state at scan time, not the latest render after a storage event.
  const learningSnapshot = useRef('');
  const requestController = useRef<AbortController | undefined>(undefined);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (stage !== 'recognizing') return;
    const started = Date.now();
    setElapsed(0);
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [stage]);
  useEffect(() => () => requestController.current?.abort(new Error('侧栏已关闭')), []);
  const waitLimit = db?.settings.timeoutSeconds === undefined ? 30 : db.settings.timeoutSeconds;
  const waitLabel = waitLimit === null ? '无限等待' : `最长 ${waitLimit} 秒`;
  const stageDetail =
    stage === 'recognizing'
      ? `已等待 ${elapsed} 秒 · ${waitLabel}。正在等待 AI 返回字段识别结果。`
      : stageDetails[stage];
  const [needsTabAccess, setNeedsTabAccess] = useState(false);
  useEffect(() => {
    const refresh = () => {
      loadDatabase()
        .then(setDb)
        .catch((e) => setMessage(errorMessage(e)));
    };
    refresh();
    browser.storage.onChanged.addListener(refresh);
    const clear = () => {
      requestController.current?.abort(new Error('页面或资料已变化，请重新识别'));
      revision.current++;
      setScan(undefined);
      setPlan([]);
      setResults([]);
      setAiPreview(false);
      setPrepared(undefined);
      setRecognizedLabels({});
      setMatchDetails({});
      setSummary('');
      setSupplements({});
      setSupplementValues({});
      setStage((s) => (s === 'idle' ? s : 'stale'));
    };
    browser.tabs.onActivated.addListener(clear);
    return () => {
      browser.storage.onChanged.removeListener(refresh);
      browser.tabs.onActivated.removeListener(clear);
    };
  }, []);
  useEffect(() => {
    const updated = (id: number, change: { url?: string; status?: string }) => {
      if (id === tabId && (change.url || change.status === 'loading')) {
        requestController.current?.abort(new Error('页面或资料已变化，请重新识别'));
        revision.current++;
        setScan(undefined);
        setPlan([]);
        setResults([]);
        setAiPreview(false);
        setPrepared(undefined);
        setRecognizedLabels({});
        setMatchDetails({});
        setSummary('');
        setSupplements({});
        setSupplementValues({});
        setStage((s) => (s === 'idle' ? s : 'stale'));
      }
    };
    browser.tabs.onUpdated.addListener(updated);
    return () => browser.tabs.onUpdated.removeListener(updated);
  }, [tabId]);
  const example = useMemo(demoProfile, []);
  const profile = demo ? example : db?.profiles.find((p) => p.id === db.activeId);
  const profileFingerprint = JSON.stringify(profile);
  const settingsFingerprint = JSON.stringify(db?.settings);
  useEffect(() => {
    if (
      ownProfileUpdate.current &&
      ownProfileUpdate.current.profile === profileFingerprint &&
      ownProfileUpdate.current.settings === settingsFingerprint
    ) {
      ownProfileUpdate.current = undefined;
      return;
    }
    ownProfileUpdate.current = undefined;
    requestController.current?.abort(new Error('页面或资料已变化，请重新识别'));
    revision.current++;
    setScan(undefined);
    setPlan([]);
    setResults([]);
    setAiPreview(false);
    setPrepared(undefined);
    setRecognizedLabels({});
    setMatchDetails({});
    setSummary('');
    setSupplements({});
    setSupplementValues({});
    setStage((s) => (s === 'idle' ? s : 'stale'));
  }, [profileFingerprint, settingsFingerprint]);
  const allFacts = profile ? facts(profile) : [];
  const run = async (fn: () => Promise<void>, aiOperation = false) => {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e) {
      const detail =
        e instanceof Error && e.name === 'TimeoutError'
          ? 'AI 请求超时，请检查服务后重新采集并识别。'
          : errorMessage(e);
      setMessage(detail);
      if (aiOperation) {
        setStage(
          /变化|过期/.test(detail) ? 'stale' : detail.includes('已取消') ? 'cancelled' : 'failed',
        );
        setAiPreview(false);
        setPrepared(undefined);
      }
    } finally {
      setBusy(false);
    }
  };
  async function send<T>(id: number, type: string, extra = {}): Promise<T> {
    const reply = await browser.tabs.sendMessage(id, { type, ...extra }, { frameId: 0 });
    if (!reply?.ok) throw new Error(reply?.error || '请重新识别页面');
    return reply.data as T;
  }
  async function identify() {
    if (!db || !profile) return;
    const scanRevision = ++revision.current;
    learningSnapshot.current = JSON.stringify([db.templates, db.mappings]);
    setReuse(undefined);
    setCheckedFields([]);
    setCrossApproved(false);
    setStage(db.settings.aiEnabled ? 'collecting' : 'idle');
    setSummary('');
    setSupplements({});
    setSupplementValues({});
    setMatchDetails({});
    setScan(undefined);
    setPrepared(undefined);
    setRecognizedLabels({});
    setAiPreview(false);
    setPlan([]);
    setResults([]);
    setNeedsTabAccess(false);
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id === undefined)
      throw new Error('没有找到当前标签页。请在安装了插件的 Chrome / Edge 窗口打开目标网页');
    if (!tab.url) {
      setNeedsTabAccess(true);
      throw new Error(
        '无法读取当前页地址，可能尚未授权或属于浏览器受限页面。请在同一个 Chrome / Edge 窗口打开目标网页，再点击工具栏中的 Resume Companion 图标。本地测试也可以点击下方授权按钮',
      );
    }
    if (!/^https?:/.test(tab.url))
      throw new Error('当前是浏览器内部页面或扩展页面。请切换到招聘网页或本地测试表单后再识别');
    const origin = new URL(tab.url).origin;
    if (demo && !['localhost', '127.0.0.1'].includes(new URL(tab.url).hostname))
      throw new Error('演示资料仅能填入本地测试页面。真实网站请使用自己的简历');
    // activeTab covers normal HTTPS use; a site grant is requested only when needed.
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    } catch {
      const granted = await browser.permissions.request({ origins: [`${origin}/*`] });
      if (!granted) throw new Error('未获得该站点访问权限，资料仍保存在本地');
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['/content-scripts/content.js'],
      });
    }
    const found = await send<LayoutScan>(tab.id, 'SCAN_TEMPLATE');
    if (revision.current !== scanRevision) throw new Error('页面或简历已变化，请重新识别');
    const resolved = resolveTemplates(
      found,
      profile,
      demo ? [] : db.templates,
      demo ? [] : db.mappings,
    );
    const request =
      db.settings.aiEnabled && resolved.unresolvedIds.length
        ? prepareIncrementalRequest(found, allFacts, resolved.unresolvedIds)
        : undefined;
    const reused = new Map(resolved.plan.map((p) => [p.id, p]));
    const nextPlan = found.fields.map(
      (field) =>
        reused.get(field.id) ||
        (db.settings.aiEnabled || resolved.details[field.id]
          ? {
              id: field.id,
              path: '',
              value: '',
              source: db.settings.aiEnabled ? '尚未发送给 AI' : '待核对',
              confidence: 0,
              selected: false,
            }
          : {
              ...matchField(field, {
                origin: found.origin,
                facts: allFacts,
                mappings: demo ? [] : db.mappings,
              }),
              source: '离线匹配 · 请核对',
            }),
    );
    setTabId(tab.id);
    setScan(found);
    setReuse(resolved);
    setResults([]);
    setPrepared(request);
    setAiPreview(!!request);
    setPlan(nextPlan);
    setRecognizedLabels(resolved.labels);
    setMatchDetails(resolved.details);
    setStage(request ? 'confirmation' : 'template');
    setSummary(
      `候选控件 ${found.fields.length} 项 · 模板复用 ${resolved.reused} 项 · AI 新识别 0 项 · 已匹配资料 ${nextPlan.filter((p) => p.path).length} 项 · 已填写 0 项`,
    );
    if (resolved.crossOrigin)
      setMessage('发现同系统其他站点的候选模板，请核对对应关系，再确认跨站点复用。');
    if (resolved.status === 'full' && !resolved.crossOrigin && nextPlan.some((p) => p.selected)) {
      const latest = await loadDatabase();
      if (
        revision.current !== scanRevision ||
        (!demo &&
          JSON.stringify(latest.profiles.find((p) => p.id === latest.activeId)) !==
            profileFingerprint) ||
        JSON.stringify([latest.templates, latest.mappings]) !== learningSnapshot.current
      )
        throw new Error('资料或模板已变化，请重新识别');
      setStage('filling');
      const executed = await send<FillResult[]>(tab.id, 'FILL_TEMPLATE', {
        token: found.token,
        items: nextPlan,
      });
      if (revision.current !== scanRevision) return;
      setResults(executed);
      setPlan(nextPlan.map((p) => ({ ...p, selected: false })));
      setStage('complete');
      setSummary(
        `候选控件 ${found.fields.length} 项 · 模板复用 ${resolved.reused} 项 · AI 新识别 0 项 · 已匹配资料 ${nextPlan.filter((p) => p.path).length} 项 · 已填写 ${executed.filter((r) => r.status === 'filled').length} 项`,
      );
      setMessage('已使用本地模板填写，未发送 AI 请求。请在网页中核对。');
    }
    if (!found.fields.length)
      setMessage('当前页未发现可填写字段。请展开经历区域后重试；嵌入框架暂需手动填写');
  }
  async function authorizeLocalTest() {
    // Request directly from this button click, before querying tabs or injecting scripts.
    const granted = await browser.permissions.request({
      origins: ['http://127.0.0.1/*', 'http://localhost/*'],
    });
    if (!granted) throw new Error('未授权本地测试页。你可以稍后重试，或回到测试页点击工具栏图标');
    setNeedsTabAccess(false);
    await identify();
  }
  async function bind(id: string, path: string) {
    if (!scan) return;
    const field = scan.fields.find((f) => f.id === id)!;
    const fact = allFacts.find((f) => f.path === path);
    if (fact && !recognizedLabels[id]) {
      setRecognizedLabels((labels) => ({
        ...labels,
        [id]:
          field.label === '未命名字段' || field.label.startsWith('待识别字段')
            ? fact.label
            : field.label,
      }));
    }
    setCheckedFields((ids) => ids.filter((checked) => checked !== id));
    setMatchDetails((details) => ({
      ...details,
      [id]: fact ? (fact.value ? '手动对应 · 已匹配资料' : '手动对应 · 缺少资料') : '未绑定资料',
    }));
    setPlan((items) =>
      items.map((p) =>
        p.id === id
          ? {
              ...p,
              path,
              value: fact?.value || '',
              source: '本次手动绑定 · 保存模板后复用',
              confidence: 1,
              selected: !!fact?.value && !field.blocked && !field.value,
            }
          : p,
      ),
    );
    if (!demo && !('layout' in scan)) {
      const latest = await loadDatabase();
      latest.mappings = latest.mappings.filter(
        (m) => !(m.origin === scan.origin && m.signature === field.signature),
      );
      if (path && field.bindingStable !== false)
        latest.mappings.push({
          origin: scan.origin,
          signature: field.signature,
          path,
          label: field.label,
        });
      await saveDatabase(latest);
    }
  }
  async function fill() {
    if (!scan || tabId === undefined || !profile) return;
    if (reuse?.crossOrigin && !crossApproved) throw new Error('请先核对并确认跨站点复用');
    const requestRevision = revision.current;
    const latest = await loadDatabase();
    const tab = await browser.tabs.get(tabId);
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (
      tab.url !== scan.url ||
      active?.id !== tabId ||
      revision.current !== requestRevision ||
      (!demo &&
        JSON.stringify(latest.profiles.find((p) => p.id === latest.activeId)) !==
          profileFingerprint) ||
      JSON.stringify([latest.templates, latest.mappings]) !== learningSnapshot.current
    )
      throw new Error('页面、资料或模板已变化，请重新识别');
    setStage('filling');
    const result = await send<FillResult[]>(tabId, 'FILL_TEMPLATE', {
      token: scan.token,
      items: plan,
    });
    if (revision.current !== requestRevision) return;
    setResults((previous) => [
      ...previous.filter((p) => !result.some((r) => r.id === p.id)),
      ...result,
    ]);
    setPlan((items) => items.map((p) => ({ ...p, selected: false })));
    setStage('complete');
    setSummary(
      `候选控件 ${scan.fields.length} 项 · 模板复用 ${reuse?.reused || 0} 项 · 已匹配资料 ${plan.filter((p) => p.path).length} 项 · 本次已填写 ${result.filter((r) => r.status === 'filled').length} 项`,
    );
    setMessage('本地填写完成，未发送 AI 请求。请在网页中核对。');
  }
  async function saveTemplate() {
    if (!scan || !('layout' in scan) || !profile || demo || !checkedFields.length) return;
    if (reuse?.crossOrigin && !crossApproved) throw new Error('请先核对并确认跨站点复用');
    const capturedRevision = revision.current;
    const latest = await loadDatabase();
    if (
      JSON.stringify(latest.profiles.find((p) => p.id === latest.activeId)) !==
        profileFingerprint ||
      JSON.stringify([latest.templates, latest.mappings]) !== learningSnapshot.current ||
      revision.current !== capturedRevision
    )
      throw new Error('资料已变化，请重新识别');
    const existing = latest.templates.find(
      (t) => t.id === reuse?.templateId && t.origin === scan.origin,
    );
    if (tabId === undefined) throw new Error('页面已变化，请重新识别');
    await send(tabId, 'CHECK_TEMPLATE', { token: scan.token });
    if (revision.current !== capturedRevision) throw new Error('页面已变化，请重新识别');
    const preserve = existing
      ? reuse?.plan
          .filter((p) => plan.some((current) => current.id === p.id && current.path === p.path))
          .map((p) => p.id) || []
      : [];
    const template = createTemplate(
      scan,
      profile,
      plan,
      recognizedLabels,
      [...new Set([...preserve, ...checkedFields])],
      existing,
    );
    const saved = await updateTemplates((templates) => [
      ...templates.filter((t) => t.id !== template.id),
      template,
    ]);
    learningSnapshot.current = JSON.stringify([saved.templates, saved.mappings]);
    setReuse(resolveTemplates(scan, profile, saved.templates, saved.mappings));
    setCheckedFields([]);
    setMessage(`已保存 ${template.fields.length} 个已核对字段；再次识别将优先本地复用。`);
  }
  const aiPayload = prepared?.payload;
  async function persistProfile(next: Profile) {
    if (demo || !profile) throw new Error('演示模式不保存新增资料');
    const latest = await loadDatabase();
    const current = latest.profiles.find((p) => p.id === latest.activeId);
    if (
      JSON.stringify(current) !== profileFingerprint ||
      JSON.stringify(latest.settings) !== settingsFingerprint
    )
      throw new Error('资料已变化，请重新采集后保存');
    latest.profiles = latest.profiles.map((p) => (p.id === next.id ? next : p));
    ownProfileUpdate.current = {
      profile: JSON.stringify(next),
      settings: JSON.stringify(latest.settings),
    };
    try {
      await saveDatabase(latest);
      setDb(latest);
    } catch (error) {
      ownProfileUpdate.current = undefined;
      throw error;
    }
  }
  async function saveSupplement(id: string) {
    const supplement = supplements[id];
    const value = supplementValues[id] || '';
    if (!profile || !scan || !supplement || !value.trim() || tabId === undefined) return;
    const capturedScan = scan;
    const field = scan.fields.find((f) => f.id === id)!;
    const next = {
      ...profile,
      custom: profile.custom.map((c) =>
        `custom.${c.id}` === supplement.path ? { ...c, value } : c,
      ),
    };
    await persistProfile(next);
    setSummary((previous) =>
      previous && !previous.startsWith('识别时统计：') ? `识别时统计：${previous}` : previous,
    );
    setSupplements((previous) => {
      const copy = { ...previous };
      delete copy[id];
      return copy;
    });
    setMatchDetails((previous) => ({
      ...previous,
      [id]: `${supplement.label} · 已保存到本地，之后按语义复用`,
    }));
    const item: PlanItem = {
      id,
      path: supplement.path,
      value,
      source: '本地补充资料',
      confidence: 1,
      selected: true,
      evidence: supplement.evidence,
    };
    setPlan((previous) => [...previous.filter((p) => p.id !== id), item]);
    if (field.blocked || field.value || ['date', 'month'].includes(field.kind)) {
      setResults((previous) => [
        ...previous.filter((r) => r.id !== id),
        { id, status: 'review', reason: '资料已保存；此控件请在网页中手动核对填写' },
      ]);
      setMessage('资料已保存在本地，之后可语义复用。');
      return;
    }
    const [active] = await browser.tabs.query({ active: true, currentWindow: true });
    if (active?.id !== tabId || active.url !== capturedScan.url)
      throw new Error('资料已保存，但页面已变化，请重新识别后填写');
    const executed = await send<FillResult[]>(tabId, 'FILL_LAYOUT', {
      token: capturedScan.token,
      items: [item],
    });
    setResults((previous) => [...previous.filter((r) => r.id !== id), ...executed]);
    setMessage(
      `补充资料已保存，本次补充已填写 ${executed.filter((r) => r.status === 'filled').length} 项。具体结果见对应卡片；之后不需要再次输入。`,
    );
  }
  async function askAI() {
    if (!db?.settings.aiEnabled || !prepared || !scan || !('layout' in scan) || tabId === undefined)
      return;
    if (reuse?.crossOrigin && !crossApproved) throw new Error('请先核对并确认跨站点复用');
    const requestRevision = revision.current;
    const snapshot = prepared;
    const capturedScan = scan;
    const capturedTab = tabId;
    const url = endpointUrl(db.settings.endpoint);
    if (!(await browser.permissions.request({ origins: [`${url.origin}/*`] })))
      throw new Error('未允许访问 AI 服务');
    const assertCurrent = async () => {
      const latest = await loadDatabase();
      const latestProfile = demo ? example : latest.profiles.find((p) => p.id === latest.activeId);
      const [active] = await browser.tabs.query({ active: true, currentWindow: true });
      if (
        revision.current !== requestRevision ||
        JSON.stringify(latestProfile) !== profileFingerprint ||
        JSON.stringify(latest.settings) !== settingsFingerprint ||
        JSON.stringify([latest.templates, latest.mappings]) !== learningSnapshot.current ||
        active?.id !== capturedTab ||
        active.url !== capturedScan.url
      )
        throw new Error('页面或简历已变化，已丢弃过期 AI 识别结果，请重新识别');
      await send(capturedTab, 'CHECK_LAYOUT', { token: capturedScan.token });
    };
    await assertCurrent();
    const controller = new AbortController();
    requestController.current = controller;
    try {
      setStage('recognizing');
      const response = await requestLayoutMappings(
        db.settings,
        await readSessionKey(),
        snapshot.payload,
        controller.signal,
      );
      await assertCurrent();
      const submittedScan = selectLayoutRegion(
        capturedScan,
        snapshot.payload.layout.controls.map((c) => c.id),
      );
      const resolved = resolveLayoutPlan(submittedScan, response, snapshot.catalog);
      const submitted = new Set(submittedScan.fields.map((f) => f.id));
      setCheckedFields((ids) => ids.filter((id) => !submitted.has(id)));
      const decisions = resolved.mappings;
      setRecognizedLabels((previous) => ({
        ...previous,
        ...Object.fromEntries(decisions.filter((d) => d.label).map((d) => [d.id, d.label])),
      }));
      setMatchDetails((previous) => ({
        ...previous,
        ...Object.fromEntries(
          decisions.map((d) => {
            const fact = d.key ? snapshot.catalog.get(d.key) : undefined;
            const detail =
              d.reason ||
              (d.status === 'matched' && fact
                ? `${fact.label}${fact.value.trim() ? ' · 已匹配资料' : ' · 缺少资料'}`
                : d.status === 'unmatched'
                  ? '未找到对应资料 key'
                  : '对应资料不确定，待核对');
            return [d.id, detail];
          }),
        ),
      }));
      const local = plan.filter((p) => !submitted.has(p.id));
      const learned = decisions.map((d) => {
        const fact =
          d.status === 'matched' && d.key && !d.reason ? snapshot.catalog.get(d.key) : undefined;
        return (
          resolved.plan.find((p) => p.id === d.id) || {
            id: d.id,
            path: fact?.path || '',
            value: fact?.value || '',
            source: 'AI 布局语义匹配',
            confidence: fact ? 1 : 0,
            selected: false,
            evidence: d.evidence,
          }
        );
      });
      const combinedPlan = [...local, ...learned].map((p) => {
        const field = capturedScan.fields.find((f) => f.id === p.id);
        if (
          field &&
          db.mappings.some(
            (m) =>
              m.origin === capturedScan.origin &&
              m.signature === field.signature &&
              m.path !== p.path,
          )
        )
          return { ...p, selected: false, source: '与手动映射冲突，待核对' };
        if (p.path && [...local, ...learned].filter((other) => other.path === p.path).length > 1)
          return { ...p, selected: false, source: '资料对应冲突，待核对' };
        return p;
      });
      setPlan(combinedPlan);
      setStage('filling');
      const executed = combinedPlan.some((p) => p.selected)
        ? await send<FillResult[]>(capturedTab, 'FILL_LAYOUT', {
            token: capturedScan.token,
            items: combinedPlan,
          })
        : [];
      // A navigation/profile update may arrive while the content script is filling.
      // Its invalidation state must not be overwritten by this operation's old UI result.
      if (revision.current !== requestRevision) return;
      const combined = [
        ...resolved.results.filter((r) => !executed.some((e) => e.id === r.id)),
        ...combinedPlan
          .filter((p) => p.source.includes('冲突'))
          .map((p) => ({ id: p.id, status: 'review' as const, reason: p.source })),
        ...executed,
      ];
      setResults(combined);
      setPlan(combinedPlan.map((p) => ({ ...p, selected: false })));
      let createdCount = 0;
      if (!demo && profile) {
        const missing = addMissingFields(profile, submittedScan, decisions, snapshot.catalog);
        createdCount = missing.profile.custom.length - profile.custom.length;
        if (createdCount) await persistProfile(missing.profile);
        setPlan((previous) =>
          previous.map((p) => {
            const supplement = missing.supplements[p.id];
            return supplement
              ? {
                  ...p,
                  path: supplement.path,
                  value: '',
                  evidence: supplement.evidence,
                  selected: false,
                }
              : p;
          }),
        );
        setSupplements(missing.supplements);
        setMatchDetails((previous) => ({ ...previous, ...missing.notes }));
        setResults(
          combined.map((result) =>
            missing.notes[result.id] && ['未找到对应资料 key', '缺少资料'].includes(result.reason)
              ? { ...result, reason: missing.notes[result.id]! }
              : result,
          ),
        );
      }
      setSummary(
        `候选控件 ${capturedScan.fields.length} 项 · 模板复用 ${reuse?.reused || 0} 项 · AI 新识别 ${decisions.filter((d) => d.label).length} 项 · 已识别名称 ${decisions.filter((d) => d.label).length} 项 · 已匹配资料 ${combinedPlan.filter((p) => p.path).length} 项 · 已填写 ${executed.filter((r) => r.status === 'filled').length} 项`,
      );
      const changedDuringFill = executed.some((r) => /变化|过期/.test(r.reason || ''));
      setStage('complete');
      setMessage(
        `${changedDuringFill ? '部分字段已变化并跳过，其余稳定字段已处理。请重新采集处理变化的字段。' : 'AI 识别并填写完成。'}${createdCount ? `已新增 ${createdCount} 个空资料字段，可在下方输入一次并保存。` : ''}请在网页中核对，插件不会提交申请。`,
      );
    } finally {
      if (requestController.current === controller) requestController.current = undefined;
      setAiPreview(false);
      setPrepared(undefined);
    }
  }
  return (
    <main className="panel">
      <header className="panel-header">
        <Brand small />
        <Button
          variant="ghost"
          aria-label="管理资料"
          onClick={() => browser.runtime.openOptionsPage()}
        >
          <Settings2 size={18} />
        </Button>
      </header>
      {stage !== 'idle' && (
        <section
          className={`ai-progress ${stage}`}
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>当前阶段：{stageLabels[stage]}</strong>
          <p>{stageDetail}</p>
          {stage === 'recognizing' && (
            <Button
              variant="ghost"
              onClick={() => requestController.current?.abort(new Error('已取消 AI 请求'))}
            >
              取消 AI 请求
            </Button>
          )}
          {summary && <p className="ai-summary">{summary}</p>}
          {message && <p>{message}</p>}
          {stage === 'confirmation' && (
            <Button
              variant="ghost"
              onClick={() =>
                document.getElementById('ai-preview')?.scrollIntoView({ block: 'center' })
              }
            >
              查看发送预览
            </Button>
          )}
        </section>
      )}
      <div className="panel-body">
        <div className="eyebrow">把时间留给下一次机会</div>
        <h1>
          少填一遍，
          <br />
          <span>多一点从容。</span>
        </h1>
        <div className="profile-picker">
          <label htmlFor="active-profile">本次使用的简历</label>
          <select
            id="active-profile"
            value={demo ? 'demo' : db?.activeId || ''}
            disabled={!db || busy}
            onChange={(e) => {
              const id = e.target.value;
              setDemo(id === 'demo');
              setScan(undefined);
              setPlan([]);
              if (id !== 'demo' && db)
                void run(async () => {
                  const latest = await loadDatabase();
                  latest.activeId = id;
                  await saveDatabase(latest);
                });
            }}
          >
            {db?.profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            <option value="demo">虚构演示 · 仅本地测试页</option>
          </select>
          <LocalNote />
        </div>
        <Button className="wide" disabled={busy || !db} onClick={() => void run(identify, true)}>
          {db?.settings.aiEnabled ? <Sparkles size={18} /> : <ScanLine size={18} />}
          {busy
            ? '处理中…'
            : ['failed', 'stale', 'cancelled'].includes(stage)
              ? '重新采集并识别'
              : '识别并填写'}
        </Button>
        {stage === 'idle' && <ErrorNotice message={message} />}
        {(needsTabAccess || (demo && !scan)) && (
          <Button
            className="wide"
            variant="secondary"
            disabled={busy || !db}
            onClick={() => void run(authorizeLocalTest, !!db?.settings.aiEnabled)}
          >
            授权本地测试页并识别
          </Button>
        )}
        {!scan ? (
          <section className="empty-state">
            <div className="empty-icon">
              <MousePointer2 size={25} />
            </div>
            <h2>准备好，再轻轻一点</h2>
            <p>
              打开网申表单，识别字段。
              <br />
              {db?.settings.aiEnabled
                ? '确认发送布局后，明确匹配的资料将从本地自动填写。'
                : '你可以先预览每一项，再决定填写。'}
            </p>
            <div className="step">
              <span>01</span> 完善简历资料
            </div>
            <div className="step">
              <span>02</span> 打开招聘网站
            </div>
            <div className="step">
              <span>03</span> 预览并填写
            </div>
            <Button variant="ghost" onClick={() => browser.runtime.openOptionsPage()}>
              去完善资料 <ArrowUpRight size={16} />
            </Button>
          </section>
        ) : (
          <>
            <div className="section-heading">
              <h2>
                表单识别与复用 <span className="count">{scan.fields.length}</span>
              </h2>
              <span className="tag">{scan.adapter}</span>
            </div>
            <p className="muted">
              {'layout' in scan
                ? '已有内容会保留。明确匹配项自动填写，不确定或不支持的项会显示原因。'
                : '已有内容会保留。不确定的字段可以重新绑定资料。'}
            </p>
            {'layout' in scan && <p className="muted">{scan.layout.limitations.join('；')}</p>}
            {reuse && (
              <section className="card">
                <h3>
                  本地模板：
                  {
                    {
                      full: '完全适用',
                      partial: '部分适用',
                      none: '暂无适用模板',
                      ambiguous: '对应有歧义',
                    }[reuse.status]
                  }
                </h3>
                <p>
                  已复用 {reuse.reused} 项，待识别或核对 {reuse.unresolvedIds.length} 项。
                </p>
                {reuse.crossOrigin && !crossApproved && (
                  <Button disabled={busy} onClick={() => setCrossApproved(true)}>
                    已核对，确认跨站点复用
                  </Button>
                )}
                <Button
                  variant="secondary"
                  disabled={busy || demo || !checkedFields.length}
                  onClick={() => void run(saveTemplate)}
                >
                  保存已核对字段
                </Button>
                {db?.settings.aiEnabled && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      if (!('layout' in scan)) return;
                      setPrepared(prepareLayoutRequest(scan, allFacts));
                      setAiPreview(true);
                      setStage('confirmation');
                    }}
                  >
                    重新学习本页
                  </Button>
                )}
                {!db?.settings.aiEnabled && (
                  <p className="muted">AI 未启用；可使用模板或手动绑定，启用 AI 后可学习新字段。</p>
                )}
              </section>
            )}
            {aiPreview && (
              <section className="card ai-preview" id="ai-preview">
                <h3>确认发送页面布局</h3>
                <p className="muted">本次等待：{waitLabel}。可在“管理资料 → 数据与设置”修改。</p>
                <p className="muted">
                  先按语义复用已有资料；确实缺少的字段会自动建为空字段，待你输入一次后保存复用。
                </p>
                <p className="muted">
                  接收地址：{db?.settings.endpoint}
                  。发送文字块、控件坐标与层级，以及不含内容的资料 key
                  目录。请检查下面的静态文字没有夹带个人信息。确认后，明确匹配项将从本地自动填写；不会提交申请。
                </p>
                <Button
                  disabled={busy || !prepared || !scan.fields.length}
                  onClick={() => void run(askAI, true)}
                >
                  确认识别并填写
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy || !prepared}
                  onClick={() =>
                    download('resume-companion-layout.json', JSON.stringify(aiPayload, null, 2))
                  }
                >
                  导出脱敏布局
                </Button>
                <details>
                  <summary>查看完整发送内容</summary>
                  <pre>{JSON.stringify(aiPayload, null, 2)}</pre>
                </details>
              </section>
            )}
            <div className="field-list">
              {scan.fields.map((field, index) => {
                const item = plan.find((p) => p.id === field.id)!;
                const result = results.find((r) => r.id === field.id);
                const title =
                  recognizedLabels[field.id] ||
                  (field.label === '未命名字段' || field.label.startsWith('待识别字段')
                    ? `${['complete', 'failed', 'stale', 'cancelled'].includes(stage) ? '未识别字段' : '待识别字段'} ${index + 1}`
                    : field.label);
                return (
                  <article className={`field-card ${result?.status || ''}`} key={field.id}>
                    <label className="field-title">
                      {
                        <input
                          type="checkbox"
                          checked={item?.selected || false}
                          disabled={busy || field.blocked || !!field.value || !item?.value}
                          onChange={(e) =>
                            setPlan((p) =>
                              p.map((i) =>
                                i.id === field.id ? { ...i, selected: e.target.checked } : i,
                              ),
                            )
                          }
                        />
                      }
                      <strong>{title}</strong>
                      {result?.status === 'filled' ? <Check size={15} /> : <CircleHelp size={15} />}
                    </label>
                    {!!field.context?.length && (
                      <p className="muted field-context">附近文字：{field.context.join(' · ')}</p>
                    )}
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label={`在网页中定位 ${title}`}
                      onClick={() =>
                        void run(async () => {
                          if (tabId === undefined) return;
                          await send(tabId, 'LOCATE', { token: scan.token, id: field.id });
                          setMessage('已滚动并高亮对应控件，未修改网页内容');
                        })
                      }
                    >
                      <MousePointer2 size={15} />
                      在网页中定位
                    </Button>
                    <div className="field-value">
                      {field.value || item?.value || '暂无可填写内容'}
                    </div>
                    {'layout' in scan && (
                      <div className="field-match">
                        资料匹配：{matchDetails[field.id] || stageDetail}
                      </div>
                    )}
                    <div className="field-status">
                      {'layout' in scan
                        ? `填写结果：${result?.reason || (stage === 'failed' || stage === 'stale' ? '本次操作已停止' : stage === 'complete' ? '未执行填写' : stage === 'filling' ? '正在本地处理' : '尚未执行填写')}`
                        : result?.reason ||
                          (field.supportReason
                            ? `控件不支持：${field.supportReason}`
                            : field.blocked
                              ? '请在网页中手动确认'
                              : field.value
                                ? '保留已有内容'
                                : item?.value
                                  ? item.source
                                  : '缺少资料 / 待绑定')}
                    </div>
                    {supplements[field.id] && (
                      <div className="field-supplement">
                        <label>
                          补充资料：{supplements[field.id]!.label}
                          <textarea
                            aria-label={`补充资料 ${title}`}
                            rows={2}
                            maxLength={20000}
                            value={supplementValues[field.id] || ''}
                            disabled={busy}
                            placeholder="输入一次，保存后在之后的表单中复用"
                            onChange={(e) =>
                              setSupplementValues((previous) => ({
                                ...previous,
                                [field.id]: e.target.value,
                              }))
                            }
                          />
                        </label>
                        <Button
                          disabled={busy || !supplementValues[field.id]?.trim()}
                          onClick={() => void run(() => saveSupplement(field.id))}
                        >
                          {field.blocked || field.value || ['date', 'month'].includes(field.kind)
                            ? '保存资料'
                            : '保存并填写'}
                        </Button>
                      </div>
                    )}
                    {
                      <div>
                        <select
                          aria-label={`绑定 ${title}`}
                          value={item?.path || ''}
                          disabled={busy}
                          onChange={(e) => void run(() => bind(field.id, e.target.value))}
                        >
                          <option value="">选择对应资料…</option>
                          {allFacts.map((f) => (
                            <option key={f.path} value={f.path}>
                              {f.label}
                              {f.value ? '' : '（未填写）'}
                            </option>
                          ))}
                        </select>
                        {item?.path && (
                          <label className="muted template-confirm">
                            <input
                              type="checkbox"
                              aria-label={`已核对 ${title}`}
                              checked={checkedFields.includes(field.id)}
                              disabled={busy || demo}
                              onChange={(e) =>
                                setCheckedFields((ids) =>
                                  e.target.checked
                                    ? [...ids, field.id]
                                    : ids.filter((id) => id !== field.id),
                                )
                              }
                            />
                            已核对，保存到模板
                          </label>
                        )}
                      </div>
                    }
                    {!('layout' in scan) && field.bindingStable === false && (
                      <p className="muted field-context">
                        缺少可靠标签，本次手动绑定不会记入跨页面填写记忆。
                      </p>
                    )}
                  </article>
                );
              })}
            </div>
          </>
        )}
      </div>
      {scan && (
        <footer className="panel-footer">
          {
            <Button
              className="wide"
              disabled={busy || !plan.some((p) => p.selected)}
              onClick={() => void run(fill, true)}
            >
              <Check size={17} />
              填写已选 {plan.filter((p) => p.selected).length} 项
            </Button>
          }
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (tabId) {
                  const r = await send<FillResult[]>(tabId, 'UNDO');
                  setResults(r);
                  setMessage(
                    `撤销完成：恢复 ${r.filter((i) => i.status === 'filled').length} 项，跳过 ${r.filter((i) => i.status !== 'filled').length} 项`,
                  );
                }
              })
            }
          >
            <RotateCcw size={15} />
            撤销上次填写
          </Button>
        </footer>
      )}
    </main>
  );
}
