import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import App from './App.tsx'

// 이미지·그림을 끌 때 브라우저가 띄우는 드래그 복사본을 막는다(-webkit-user-drag를 모르는 브라우저용).
// 입력칸의 글자 끌기는 그대로 둔다.
document.addEventListener('dragstart', (event) => {
  const target = event.target
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return
  event.preventDefault()
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
