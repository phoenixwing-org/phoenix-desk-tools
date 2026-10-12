<script setup lang="ts">
import { computed, ref, watch } from "vue";
import type { CadObjectInfoResult } from "./types";
const props = defineProps<{ result: CadObjectInfoResult }>();
const page = ref(1), pageSize = 50;
const pageCount = computed(() => Math.max(1, Math.ceil(props.result.document.objects.length / pageSize)));
const objects = computed(() => props.result.document.objects.slice((page.value - 1) * pageSize, page.value * pageSize));
const valueText = (value: string | number | null) => value === null ? "未保存" : value === "" ? "（空值）" : String(value);
watch(() => props.result, () => { page.value = 1; });
</script>

<template>
  <div class="object-document">
    <p class="document-summary">{{ result.document.objects.length }} 个对象 · {{ result.document.root_names.length }} 个根 · {{ result.document.xlinks.length }} 个 XLink</p>
    <p class="document-hint">静态读取已保存的 Document.xml，不执行 FreeCAD、重算几何或修改模型/索引。Placement 为保存的局部变换，不是世界坐标；level 为从根广度优先首次到达的深度，未到达对象也为 0。有效 BOM 标记不是制造数量。</p>
    <p class="source-stamp">源文件快照：{{ result.source.file_size }} 字节 · Document.xml 原始 {{ result.source.document_xml_bytes }} 字节（UTF-8，BOM 若有则计入） · 修改时间 {{ new Date(result.source.mtime_ms).toISOString() }}</p>
    <section v-if="result.warnings.length" aria-label="解析提示" class="object-warnings">
      <h3>解析提示</h3><ul><li v-for="(warning, index) in result.warnings" :key="index">{{ warning }}</li></ul>
    </section>
    <details class="document-section" open>
      <summary>根对象 root_names</summary>
      <ul v-if="result.document.root_names.length"><li v-for="(name, index) in result.document.root_names" :key="index">{{ name }}</li></ul>
      <p v-else>没有符合 BOM 类型及 Group 父关系条件的根对象。</p>
    </details>
    <details class="document-section">
      <summary>XLink 引用（{{ result.document.xlinks.length }}）</summary>
      <table v-if="result.document.xlinks.length"><thead><tr><th>文件属性</th><th>标签</th></tr></thead><tbody>
        <tr v-for="(link, index) in result.document.xlinks" :key="index"><td>{{ link.file }}</td><td>{{ valueText(link.label) }}</td></tr>
      </tbody></table>
      <p v-else>没有保存的 XLink 引用。</p>
    </details>
    <section aria-label="完整对象列表" class="document-section">
      <h3>完整对象列表</h3>
      <p v-if="!result.document.objects.length">文档没有对象。</p>
      <p v-else class="document-hint">每页显示 {{ pageSize }} 个对象；展开查看全部属性、子对象和局部 Placement。</p>
      <details v-for="(object, index) in objects" :key="`${page}:${index}:${object.name}`" class="object-row">
        <summary><strong>{{ object.name }}</strong> · {{ valueText(object.label) }} <span>{{ object.type_id }} · level {{ object.level }}</span></summary>
        <dl class="object-metadata">
          <dt>内部名称 name</dt><dd>{{ object.name }}</dd>
          <dt>标签 label</dt><dd>{{ valueText(object.label) }}</dd>
          <dt>类型 type_id</dt><dd>{{ object.type_id }}</dd>
          <dt>有效 BOM 类型</dt><dd>{{ object.is_valid_bom_item ? '是' : '否' }}</dd>
          <dt>层级 level</dt><dd>{{ object.level }}</dd>
          <dt>Material</dt><dd>{{ valueText(object.material) }}</dd>
          <dt>子对象 children</dt><dd><ul v-if="object.children.length"><li v-for="(child, childIndex) in object.children" :key="childIndex">{{ child }}</li></ul><span v-else>无</span></dd>
        </dl>
        <h4>局部 Placement</h4>
        <dl v-if="object.placement" class="object-metadata placement">
          <template v-for="key in (['x', 'y', 'z', 'q0', 'q1', 'q2', 'q3'] as const)" :key="key"><dt>{{ key }}</dt><dd>{{ object.placement[key] }}</dd></template>
        </dl>
        <p v-else>未保存</p>
        <h4>全部标量属性 properties</h4>
        <table v-if="Object.keys(object.properties).length"><thead><tr><th>属性名</th><th>值</th></tr></thead><tbody>
          <tr v-for="(value, name) in object.properties" :key="name"><th scope="row">{{ name }}</th><td>{{ valueText(value) }}</td></tr>
        </tbody></table>
        <p v-else>没有保存的标量属性。复杂属性不强转为 0，请核对解析提示。</p>
      </details>
      <nav v-if="pageCount > 1" aria-label="对象列表分页" class="object-pagination">
        <button type="button" :disabled="page === 1" @click="page--">上一页</button><span>第 {{ page }} / {{ pageCount }} 页</span><button type="button" :disabled="page === pageCount" @click="page++">下一页</button>
      </nav>
    </section>
  </div>
</template>

<style scoped>
.object-document { display: flex; flex-direction: column; gap: 12px; }
.object-document p { margin: 0; }
.document-hint, .source-stamp { font-size: 0.8rem; color: var(--muted); line-height: 1.6; }
.document-summary { font-weight: 600; }
.document-section, .object-row { padding: 12px; border: 1px solid var(--border); border-radius: 6px; }
.object-row + .object-row { margin-top: 8px; }
summary { cursor: pointer; line-height: 1.6; overflow-wrap: anywhere; }
summary span { color: var(--muted); font-size: 0.8rem; }
h3, h4 { margin: 0 0 10px; font-size: 0.9rem; }
h4 { margin-top: 16px; }
.object-metadata { display: grid; grid-template-columns: minmax(120px, 150px) minmax(0, 1fr); gap: 6px 12px; font-size: 0.85rem; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
dd ul { margin: 0; padding-left: 16px; }
table { width: 100%; border-collapse: collapse; font-size: 0.85rem; table-layout: fixed; margin-top: 8px; }
th, td { text-align: left; vertical-align: top; padding: 6px 10px; border-bottom: 1px solid var(--border); overflow-wrap: anywhere; white-space: pre-wrap; }
th { width: 35%; font-weight: 500; }
.object-warnings { background: var(--panel-head-bg); padding: 12px; border-radius: 6px; }
.object-warnings ul { margin: 0; padding-left: 20px; }
.object-pagination { display: flex; justify-content: center; align-items: center; gap: 14px; margin-top: 12px; }
</style>
