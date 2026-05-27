import React, { useCallback, useEffect, useState } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { AgentTree } from './components/AgentTree';
import { Toolbar } from './components/Toolbar';
import { WorkflowCanvas } from './components/WorkflowCanvas';
import type {
  CanticaNamespace,
  CanticaPrompt,
  ExtensionSettings,
  IncomingMessage,
  VscodeApi,
} from './types';

// acquireVsCodeApi is injected by VS Code into every webview at runtime.
declare function acquireVsCodeApi(): VscodeApi;
const vscode = acquireVsCodeApi();

export function App() {
  const [namespaces, setNamespaces] = useState<CanticaNamespace[]>([]);
  const [prompts, setPrompts] = useState<CanticaPrompt[]>([]);
  const [error, setError] = useState<string | undefined>();
  const [settings, setSettings] = useState<ExtensionSettings>({
    serverUrl: 'http://localhost:8042',
    authToken: '',
    explorerSide: 'left',
  });
  const [explorerSide, setExplorerSide] = useState<'left' | 'right'>('left');

  useEffect(() => {
    const handler = (event: MessageEvent<IncomingMessage>) => {
      const msg = event.data;
      switch (msg.type) {
        case 'updateAgents':
          setNamespaces(msg.namespaces);
          setPrompts(msg.prompts);
          setError(undefined);
          break;
        case 'updateSettings':
          setSettings(msg.settings);
          setExplorerSide(msg.settings.explorerSide);
          break;
        case 'error':
          setError(msg.message);
          break;
        default: {
          const _exhaustive: never = msg;
          void _exhaustive;
        }
      }
    };
    window.addEventListener('message', handler);
    vscode.postMessage({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  const toggleExplorerSide = useCallback(() => {
    const next: 'left' | 'right' = explorerSide === 'left' ? 'right' : 'left';
    setExplorerSide(next);
    vscode.postMessage({ type: 'explorerSideChanged', side: next });
  }, [explorerSide]);

  const onRefresh = useCallback(() => {
    vscode.postMessage({ type: 'refresh' });
  }, []);

  const onOpenPrompt = useCallback((namespace: string, name: string) => {
    vscode.postMessage({ type: 'openPrompt', namespace, name });
  }, []);

  const onSaveWorkflow = useCallback((workflow: unknown) => {
    vscode.postMessage({ type: 'saveWorkflow', workflow });
  }, []);

  const explorer = (
    <AgentTree
      namespaces={namespaces}
      prompts={prompts}
      {...(error !== undefined ? { error } : {})}
      onOpenPrompt={onOpenPrompt}
    />
  );

  const canvas = (
    <ReactFlowProvider>
      <WorkflowCanvas
        namespaces={namespaces}
        prompts={prompts}
        onSave={onSaveWorkflow}
      />
    </ReactFlowProvider>
  );

  return (
    <div className="cs-root">
      <Toolbar
        explorerSide={explorerSide}
        serverUrl={settings.serverUrl}
        onToggleSide={toggleExplorerSide}
        onRefresh={onRefresh}
      />
      <div className="cs-workspace">
        {explorerSide === 'left' ? (
          <>
            <aside className="cs-explorer">{explorer}</aside>
            <main className="cs-canvas">{canvas}</main>
          </>
        ) : (
          <>
            <main className="cs-canvas">{canvas}</main>
            <aside className="cs-explorer cs-explorer--right">{explorer}</aside>
          </>
        )}
      </div>
    </div>
  );
}
