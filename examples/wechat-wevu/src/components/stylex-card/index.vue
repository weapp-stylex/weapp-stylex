<script setup lang="ts">
import * as stylex from 'weapp-stylex'
import { computed } from 'wevu'
import { darkTheme, lightTheme, styles } from '../../styles'

const props = defineProps<{ dark: boolean }>()
defineComponentJson({
  component: true,
  options: { styleIsolation: 'isolated' },
})
const attrs = computed(() =>
  stylex.attrs(props.dark ? darkTheme : lightTheme, styles.card),
)
</script>

<template>
  <view id="stylex-card-root" :class="attrs.class" :style="attrs.style">
    组件样式也能复用
  </view>
</template>
