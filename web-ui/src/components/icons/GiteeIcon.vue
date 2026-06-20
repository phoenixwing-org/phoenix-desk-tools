<script setup lang="ts">
import giteeLogo from "../../assets/icons/gitee-logo.svg";
</script>

<template>
  <img class="gitee-icon" :src="giteeLogo" alt="" width="18" height="18" decoding="async" />
</template>

<style scoped>
.gitee-icon {
  display: block;
  width: 18px;
  height: 18px;
  transform-origin: center;
}
</style>
