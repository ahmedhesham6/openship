"use client";

import { useState } from "react";
import {
  Server,
  Loader2,
  Check,
  KeyRound,
  Lock,
  ChevronDown,
  Network,
  X,
} from "lucide-react";
import { getApiErrorMessage, systemApi } from "@/lib/api";
import type { ServerInfo } from "@/lib/api/system";
import { useToast } from "@/context/ToastContext";

const INPUT =
  "w-full px-3.5 py-2.5 rounded-xl border border-border/50 bg-muted/30 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none transition-all focus:ring-2 focus:ring-primary/20";

const LABEL = "block text-sm font-medium text-muted-foreground mb-1.5";

interface AddServerModalProps {
  onCancel: () => void;
  onCreated: (server: ServerInfo) => void;
}

// Slim variant of /servers/new — credentials only, no capability picker
// (deploy flow always wants runsApps=true) and no component-install step
// (user can finish that on the server detail page after picking it). On save
// we hand the saved ServerInfo back so the picker can select it immediately.
export function AddServerModal({ onCancel, onCreated }: AddServerModalProps) {
  const { showToast } = useToast();

  const [serverName, setServerName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUser, setSshUser] = useState("root");
  const [sshAuthMethod, setSshAuthMethod] = useState<"password" | "key">("password");
  const [sshPassword, setSshPassword] = useState("");
  const [sshKeyPath, setSshKeyPath] = useState("");
  const [sshKeyPassphrase, setSshKeyPassphrase] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [jumpHost, setJumpHost] = useState("");
  const [extraArgs, setExtraArgs] = useState("");

  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState(false);
  const [saving, setSaving] = useState(false);

  async function handleTest() {
    if (!sshHost.trim()) {
      showToast("Server IP address is required", "error", "Server");
      return;
    }
    if (sshAuthMethod === "password" && !sshPassword) {
      showToast("Password is required to test connection", "error", "Server");
      return;
    }
    if (sshAuthMethod === "key" && !sshKeyPath) {
      showToast("Key path is required to test connection", "error", "Server");
      return;
    }

    setTesting(true);
    setTestOk(false);
    try {
      const payload: Parameters<typeof systemApi.testConnection>[0] = {
        sshHost: sshHost.trim(),
        sshPort: parseInt(sshPort, 10) || 22,
        sshUser: sshUser.trim() || "root",
        sshAuthMethod,
      };
      if (sshAuthMethod === "password" && sshPassword) {
        payload.sshPassword = sshPassword;
      }
      if (sshAuthMethod === "key") {
        if (sshKeyPath) payload.sshKeyPath = sshKeyPath;
        if (sshKeyPassphrase) payload.sshKeyPassphrase = sshKeyPassphrase;
      }
      const result = await systemApi.testConnection(payload);
      setTestOk(result.ok);
      if (result.ok) {
        showToast("Connection successful", "success", "Server");
      } else {
        showToast(result.message || "Connection failed", "error", "Server");
      }
    } catch (err) {
      showToast(getApiErrorMessage(err, "Connection test failed"), "error", "Server");
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    if (!sshHost.trim()) {
      showToast("Server IP address is required", "error", "Server");
      return;
    }
    if (sshAuthMethod === "password" && !sshPassword) {
      showToast("Password is required", "error", "Server");
      return;
    }
    if (sshAuthMethod === "key" && !sshKeyPath) {
      showToast("Key path is required", "error", "Server");
      return;
    }

    setSaving(true);
    try {
      const data: Record<string, unknown> = {
        name: serverName.trim() || null,
        runsApps: true,
        runsMail: false,
        sshHost: sshHost.trim(),
        sshPort: parseInt(sshPort, 10) || 22,
        sshUser: sshUser.trim() || "root",
        sshAuthMethod,
        sshJumpHost: jumpHost.trim() || null,
        sshArgs: extraArgs.trim() || null,
      };
      if (sshAuthMethod === "password" && sshPassword) {
        data.sshPassword = sshPassword;
      }
      if (sshAuthMethod === "key") {
        if (sshKeyPath) data.sshKeyPath = sshKeyPath;
        if (sshKeyPassphrase) data.sshKeyPassphrase = sshKeyPassphrase;
      }
      const created = await systemApi.createServerEntry(data);
      showToast("Server saved", "success", "Server");
      onCreated(created);
    } catch (err) {
      showToast(getApiErrorMessage(err, "Failed to save server"), "error", "Server");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="rounded-2xl overflow-hidden border border-border/50"
      style={{ backgroundColor: "var(--th-card-bg-solid, var(--card))" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border/50">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 bg-blue-500/10 rounded-xl flex items-center justify-center shrink-0">
            <Server className="size-[18px] text-blue-500" />
          </div>
          <div className="min-w-0">
            <h2 className="font-semibold text-foreground text-[15px] truncate">
              Add your server
            </h2>
            <p className="text-xs text-muted-foreground truncate">
              Connect via SSH. You can finish setup later.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="w-8 h-8 rounded-lg hover:bg-muted flex items-center justify-center transition-colors disabled:opacity-50 shrink-0"
        >
          <X className="size-4 text-muted-foreground" />
        </button>
      </div>

      {/* Body */}
      <div className="p-5 space-y-[18px] max-h-[70vh] overflow-y-auto">
        <div>
          <label className={LABEL}>Server Name</label>
          <input
            type="text"
            value={serverName}
            onChange={(e) => setServerName(e.target.value)}
            placeholder={sshHost.trim() || "e.g. Production, Staging, Dev..."}
            spellCheck={false}
            autoComplete="off"
            className={INPUT}
          />
          <p className="text-xs text-muted-foreground/60 mt-1.5">
            Optional label shown in the picker.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px] gap-3">
          <div>
            <label className={LABEL}>Server IP Address</label>
            <input
              type="text"
              value={sshHost}
              onChange={(e) => setSshHost(e.target.value)}
              placeholder="123.45.67.89"
              spellCheck={false}
              autoComplete="off"
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL}>Port</label>
            <input
              type="text"
              value={sshPort}
              onChange={(e) => setSshPort(e.target.value)}
              placeholder="22"
              className={INPUT}
            />
          </div>
        </div>

        <div>
          <label className={LABEL}>Username</label>
          <input
            type="text"
            value={sshUser}
            onChange={(e) => setSshUser(e.target.value)}
            placeholder="root"
            spellCheck={false}
            autoComplete="off"
            className={INPUT}
          />
        </div>

        <div>
          <label className={LABEL}>Authentication</label>
          <div className="flex gap-1 bg-muted/50 rounded-[10px] p-[3px] mb-3">
            <button
              type="button"
              onClick={() => setSshAuthMethod("password")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-medium rounded-lg transition-all ${
                sshAuthMethod === "password"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/70"
              }`}
            >
              <Lock className="size-3.5" />
              Password
            </button>
            <button
              type="button"
              onClick={() => setSshAuthMethod("key")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-medium rounded-lg transition-all ${
                sshAuthMethod === "key"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground/70"
              }`}
            >
              <KeyRound className="size-3.5" />
              SSH Key
            </button>
          </div>

          {sshAuthMethod === "password" ? (
            <div>
              <label className={LABEL}>Password</label>
              <input
                type="password"
                value={sshPassword}
                onChange={(e) => setSshPassword(e.target.value)}
                placeholder="Enter server password"
                autoComplete="off"
                className={INPUT}
              />
            </div>
          ) : (
            <div className="space-y-[18px]">
              <div>
                <label className={LABEL}>Key Path</label>
                <input
                  type="text"
                  value={sshKeyPath}
                  onChange={(e) => setSshKeyPath(e.target.value)}
                  placeholder="~/.ssh/id_rsa"
                  spellCheck={false}
                  autoComplete="off"
                  className={INPUT}
                />
              </div>
              <div>
                <label className={LABEL}>
                  Passphrase{" "}
                  <span className="text-muted-foreground/50 font-normal">(optional)</span>
                </label>
                <input
                  type="password"
                  value={sshKeyPassphrase}
                  onChange={(e) => setSshKeyPassphrase(e.target.value)}
                  placeholder="Enter passphrase or leave blank"
                  autoComplete="off"
                  className={INPUT}
                />
              </div>
            </div>
          )}
        </div>

        <button
          type="button"
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
        >
          <ChevronDown
            className={`size-3.5 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
          />
          Advanced
        </button>

        {showAdvanced && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>
                Jump Host{" "}
                <span className="text-muted-foreground/50 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={jumpHost}
                onChange={(e) => setJumpHost(e.target.value)}
                placeholder="user@bastion.example.com"
                spellCheck={false}
                autoComplete="off"
                className={INPUT}
              />
            </div>
            <div>
              <label className={LABEL}>
                Extra SSH Args{" "}
                <span className="text-muted-foreground/50 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={extraArgs}
                onChange={(e) => setExtraArgs(e.target.value)}
                placeholder="-o StrictHostKeyChecking=no"
                spellCheck={false}
                autoComplete="off"
                className={INPUT}
              />
            </div>
          </div>
        )}
      </div>

      {/* Footer actions */}
      <div className="px-5 py-4 border-t border-border/50 bg-muted/10 space-y-2.5">
        <button
          type="button"
          onClick={handleTest}
          disabled={testing || saving || !sshHost.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 border border-border/50 bg-card text-foreground text-sm font-medium rounded-xl hover:bg-muted/60 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {testing ? (
            <Loader2 className="size-4 animate-spin" />
          ) : testOk ? (
            <Check className="size-4 text-emerald-500" />
          ) : (
            <Network className="size-4" />
          )}
          {testing ? "Testing…" : testOk ? "Connected" : "Test Connection"}
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !sshHost.trim()}
          className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-xl hover:bg-primary/90 transition-all hover:shadow-lg hover:shadow-primary/25 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {saving ? "Saving…" : "Save server"}
        </button>
      </div>
    </div>
  );
}
