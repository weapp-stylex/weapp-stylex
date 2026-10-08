<script setup lang="ts">
import * as stylex from '@weapp-stylex/core'
import { lightTheme, styles } from '../../styles'

const attrs = stylex.attrs(lightTheme, styles.card)
</script>

<template>
  <view id="stylex-detail" :class="attrs.class" :style="attrs.style">
    普通分包页面
  </view>
</template>
