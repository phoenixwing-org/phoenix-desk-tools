import ElementPlus from "element-plus";
import "element-plus/dist/index.css";
import { createApp } from "vue";
import UnitTestWatchlistPaneFixture from "./UnitTestWatchlistPane.fixture.vue";
import "../src/style.css";

createApp(UnitTestWatchlistPaneFixture).use(ElementPlus).mount("#app");
