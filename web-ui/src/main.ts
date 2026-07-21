import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import "./style.css";
import { initializeRuntimeBridge } from "./utils/runtimeBridge";

async function bootstrap(): Promise<void> {
  await initializeRuntimeBridge();
  const app = createApp(App);
  app.use(createPinia());
  app.mount("#app");
}

void bootstrap();
