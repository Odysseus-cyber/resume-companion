import { Leaf, LockKeyhole } from 'lucide-react';
export function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? 'small' : ''}`}>
      <span className="brand-mark">
        <Leaf size={small ? 21 : 25} />
      </span>
      <span className="brand-wordmark">
        Resume
        <br />
        Companion<small>LOCAL FIRST · OPEN SOURCE</small>
      </span>
    </div>
  );
}
export function LocalNote() {
  return (
    <div className="local-note">
      <LockKeyhole size={14} /> 资料保存在这台设备 · 核对后由你提交
    </div>
  );
}
export function ErrorNotice({ message }: { message: string }) {
  return message ? (
    <div className="notice" role="status">
      {message}
    </div>
  ) : null;
}
export function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : '操作未完成，请重试';
}
