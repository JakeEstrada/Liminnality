/** One listener owns the microphone. The help window takes it from the shop wake listener. */
type Listener = () => void;

let owner = '';
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((listener) => listener());
}

export function microphoneOwner() {
  return owner;
}

export function microphoneHeldBy(name: string) {
  return owner === name;
}

export function claimMicrophone(name: string) {
  if (!name || owner === name) return;
  owner = name;
  notify();
}

export function releaseMicrophone(name: string) {
  if (owner !== name) return;
  owner = '';
  notify();
}

export function subscribeMicrophone(listener: Listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
