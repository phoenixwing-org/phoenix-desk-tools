import { createPinia } from "pinia";
import { createApp } from "vue";
import AssemblyTreeTableFixture from "./AssemblyTreeTable.fixture.vue";
import "../src/style.css";

createApp(AssemblyTreeTableFixture)
  .use(createPinia())
  .mount("#app");
