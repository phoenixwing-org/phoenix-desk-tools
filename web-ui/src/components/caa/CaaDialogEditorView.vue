<script setup lang="ts">
import { storeToRefs } from "pinia";
import { useCaaDialogPageStore } from "../../stores/caaDialogPage";
import CaaDialogCanvas from "./CaaDialogCanvas.vue";

const props = defineProps<{
  hasParsed?: boolean;
}>();
const store = useCaaDialogPageStore();
const { ir } = storeToRefs(store);
</script>

<template>
  <div class="caa-editor-view">
    <p v-if="store.caaOnline === false" class="banner banner-warn">
      CAA 服务离线。侧栏「属性 → CAA 服务」查看端口与启动说明。
    </p>
    <p v-if="store.errorText" class="banner banner-err">{{ store.errorText }}</p>

    <el-empty
      v-if="!hasParsed && !store.loading"
      class="caa-empty"
      description="点击「解析」加载 .CATDlg、多语言 .CATNls、.CATRsc 与位图目录"
      :image-size="72"
    />
    <CaaDialogCanvas v-else class="caa-main" :ir="ir" />
  </div>
</template>

<style scoped>
.caa-editor-view {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  gap: 10px;
}

.banner {
  margin: 0;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 0.85rem;
}

.banner-warn {
  background: #fffbeb;
  border: 1px solid #fcd34d;
}

.banner-err {
  background: #fef2f2;
  border: 1px solid #fca5a5;
}

.caa-main {
  flex: 0 0 auto;
  min-width: 0;
}

.caa-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
