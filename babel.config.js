module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        targets: {
          node: '4'
        }
      }
    ]
  ],
  plugins: [['@babel/plugin-proposal-object-rest-spread', { useBuiltIns: true }]]
}
