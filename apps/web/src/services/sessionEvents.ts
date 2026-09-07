// A tiny pub/sub used to let the shared HTTP interceptor (services/httpInterceptor.ts)
// notify the authentication layer (auth/AuthContext.tsx) without either module
// importing the other, and without either importing React Router.
type Listener = () => void;

function createSignal() {
  const listeners = new Set<Listener>();
  return {
    subscribe(listener: Listener): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit(): void {
      listeners.forEach((listener) => listener());
    }
  };
}

const sessionExpiredSignal = createSignal();
const passwordChangeRequiredSignal = createSignal();

export const onSessionExpired = sessionExpiredSignal.subscribe;
export const notifySessionExpired = sessionExpiredSignal.emit;

export const onPasswordChangeRequired = passwordChangeRequiredSignal.subscribe;
export const notifyPasswordChangeRequired = passwordChangeRequiredSignal.emit;
