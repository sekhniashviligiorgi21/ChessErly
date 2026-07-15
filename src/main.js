import { createApp } from 'vue'
import App from './App.vue'
import { createRouter, createWebHistory } from 'vue-router'
import Analysis from './pages/Analysis.vue'
import Review from './pages/Review.vue'
import Play from './pages/Play.vue'
import Insights from './pages/Insights.vue'

const routes = [
	{ path: "/", component: Analysis },
	{ path: "/Review", component: Review },
	{ path: "/Insights", component: Insights },
	{ path: "/vsComputer", component: Play }, 
]

const router = createRouter({
	history: createWebHistory(),
	routes
})

export default router

const app = createApp(App)
app.use(router)
app.mount('#app')