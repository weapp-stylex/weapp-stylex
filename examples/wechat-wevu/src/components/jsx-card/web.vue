<script setup lang="ts">
import * as stylex from 'weapp-stylex'
import { lightTheme, styles } from '../../styles'

const attrs = stylex.attrs(lightTheme, styles.card)
</script>

<template>
  <view :class="attrs.class" :style="attrs.style">
    <text>共享样式组件</text>
  </view>
</template>
