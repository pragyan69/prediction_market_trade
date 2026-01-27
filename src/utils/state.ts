import type { AppState } from "../types";

// Global application state - shared across modules
export const appState: AppState = {
  provider: null,
  signer: null,
  signerAddress: null,
  apiCreds: null,
  client: null,
  lastVerify: null,
};

export function updateState(updates: Partial<AppState>) {
  Object.assign(appState, updates);
}

export function getClient() {
  return appState.client;
}

export function getSigner() {
  return appState.signer;
}

export function getSignerAddress() {
  return appState.signerAddress;
}

export function getApiCreds() {
  return appState.apiCreds;
}

export function isConnected(): boolean {
  return appState.signer !== null && appState.signerAddress !== null;
}

export function hasApiCreds(): boolean {
  return appState.apiCreds !== null;
}

export function hasClient(): boolean {
  return appState.client !== null;
}
