<script setup lang="ts">
defineProps<{ title: string; subtitle?: string; width?: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal" :style="{ width: width ?? '620px' }">
      <header class="modal-head">
        <div>
          <h2>{{ title }}</h2>
          <p v-if="subtitle">{{ subtitle }}</p>
        </div>
        <button class="btn btn-xs ghost" @click="emit('close')">✕</button>
      </header>
      <div class="modal-body">
        <slot />
      </div>
      <footer v-if="$slots.footer" class="modal-foot">
        <slot name="footer" />
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(2px);
  display: grid;
  place-items: center;
  z-index: 60;
  padding: 20px;
}
.modal {
  max-width: 100%;
  max-height: 88vh;
  display: flex;
  flex-direction: column;
  background: var(--panel-bg);
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(15, 23, 42, 0.28);
  overflow: hidden;
}
.modal-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 16px 18px 12px;
  border-bottom: 1px solid var(--border-soft);
}
.modal-head h2 {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
}
.modal-head p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-dim);
}
.modal-body {
  padding: 16px 18px;
  overflow: auto;
}
.modal-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 18px;
  border-top: 1px solid var(--border-soft);
  background: var(--bar-bg);
}
</style>
