import { createApp } from 'vue'
import { createPinia } from 'pinia'

import './style.css'
import App from './App.vue'
import { armAudioOnFirstGesture } from './lib/notify'

// Браузер не даёт проигрывать звук, пока пользователь не взаимодействовал
// со страницей. Поднимаем звуковой контекст на первом же клике или
// нажатии клавиши - до этого уведомления просто беззвучны.
armAudioOnFirstGesture()

createApp(App).use(createPinia()).mount('#app')
