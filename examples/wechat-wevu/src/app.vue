<script setup lang="ts">
defineAppJson({
  pages: ['pages/index/index'],
  subPackages: [{ root: 'subpackage', pages: ['detail/index'] }],
  window: { navigationBarTitleText: 'StyleX + Wevu' },
})
</script>
