<script setup lang="ts">
import * as stylex from '@weapp-stylex/core'
import { computed } from 'vue'
import { darkTheme, lightTheme, styles } from '../../styles'

const props = defineProps<{ dark: boolean }>()
const attrs = computed(() =>
  stylex.attrs(props.dark ? darkTheme : lightTheme, styles.card),
)
</script>

<template>
  <view id="stylex-card-root" :class="attrs.class" :style="attrs.style">
    组件样式也能复用
  </view>
</template>
