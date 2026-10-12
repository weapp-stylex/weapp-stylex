<script setup lang="ts">
import * as stylex from 'weapp-stylex'
import { styles } from '../../styles'

defineComponentJson({ component: true, options: { styleIsolation: 'isolated' } })
const attrs = stylex.attrs(styles.card)
</script>

<template>
  <view id="stylex-inherited-root" :class="attrs.class" :style="attrs.style">
    继承页面主题
  </view>
</template>
