import * as stylex from '@weapp-stylex/core';

const styles = stylex.create({
  card: {
    backgroundColor: 'white',
    borderRadius: 18,
    boxShadow: '0 8px 24px rgba(23, 32, 51, 0.08)',
    marginTop: 24,
    padding: 20,
  },
  title: {
    color: '#172033',
    fontSize: 17,
    fontWeight: 600,
  },
  description: {
    color: '#65708a',
    fontSize: 13,
    lineHeight: 1.5,
    marginTop: 8,
  },
});

const sx = {
  card: stylex.attrs(styles.card).class,
  title: stylex.attrs(styles.title).class,
  description: stylex.attrs(styles.description).class,
};

Component({
  properties: {
    title: String,
  },
  data: { sx },
});
