<script setup lang="ts">
import * as stylex from 'weapp-stylex'
import { computed, ref } from 'wevu'
import styles, { darkTheme, lightTheme } from '../../styles'

definePageJson({
  usingComponents: {
    'stylex-card': '../../components/stylex-card/index',
    'jsx-card': '../../components/jsx-card/index',
  },
})
const active = ref(false)
const dark = ref(false)
const width = ref(80)
const inline = stylex.create({ label: { marginTop: 8, fontSize: 14 } })
const root = computed(() =>
  stylex.attrs(dark.value ? darkTheme : lightTheme, styles.root),
)
const button = computed(() =>
  stylex.attrs(styles.button, active.value && styles.active),
)
const title = stylex.attrs(styles.title)
const label = stylex.attrs(inline.label)
const meter = computed(() => stylex.attrs(styles.meter(width.value)))
function toggle() {
  active.value = !active.value
}
function toggleTheme() {
  dark.value = !dark.value
}
function grow() {
  width.value = width.value === 80 ? 120 : 80
}
</script>

<template>
  <view
    id="stylex-root"
    data-testid="stylex-root"
    :class="root.class"
    :style="root.style"
  >
    <text :class="title.class">
      共享 StyleX 样式
    </text>
    <view :class="label.class">
      独立文件 · Vue SFC 内联 · 动态尺寸
    </view>
    <stylex-card :dark="dark" />
    <jsx-card />
    <view id="stylex-toggle" :class="button.class" @tap="toggle">
      点击查看条件样式
    </view>
    <button id="stylex-theme" @tap="toggleTheme">
      切换主题
    </button>
    <button @tap="grow">
      动态尺寸
    </button>
    <view
      id="stylex-meter"
      data-testid="stylex-meter"
      :class="meter.class"
      :style="meter.style"
    >
      尺寸 {{ width }}
    </view>
  </view>
</template>
