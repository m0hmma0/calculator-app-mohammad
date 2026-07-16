import { registerRootComponent } from 'expo';

import App from './App';

// registerRootComponent يستدعي AppRegistry.registerComponent('main', () => App);
// كما يضبط البيئة بشكل مناسب سواء في Expo Go أو في بناء أصلي (native build).
registerRootComponent(App);
