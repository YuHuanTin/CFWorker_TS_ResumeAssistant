import { ref } from 'vue';

export const confirmation = ref<{ title: string; detail: string } | null>(null);
let pending: ((confirmed: boolean) => void) | null = null;

export function confirmAction(title: string, detail = ''): Promise<boolean> {
  pending?.(false);
  confirmation.value = { title, detail };
  return new Promise((resolve) => { pending = resolve; });
}

export function finishConfirmation(confirmed: boolean): void {
  confirmation.value = null;
  pending?.(confirmed);
  pending = null;
}
