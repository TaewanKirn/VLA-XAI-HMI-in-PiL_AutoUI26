import { motion, AnimatePresence } from 'framer-motion'
import { X, CheckCircle2, AlertTriangle, ShieldCheck, ChevronRight, Info } from 'lucide-react'

export default function BriefingPanel({ onClose, simStage, simType, onApprove, onWait }) {
  const isAquaplaning = simType === 'aquaplaning'

  const getBriefingContent = () => {
    if (isAquaplaning) {
      if (simStage === 'aquaplaning_active') {
        return {
          title: '노면 수막현상 감지',
          status: '위험 대응 중',
          icon: AlertTriangle,
          iconColor: 'text-[#FF3B30]',
          bg: 'bg-[#FF3B30]/5',
          description: '전방 도로에 수막현상이 감지되었습니다. 차량 제어권을 유지하기 위해 안전한 속도로 자동 감속합니다.',
          actions: []
        }
      }
      return null
    }

    // Default Roundabout logic
    switch (simStage) {
      case 'prompting':
        return {
          title: '합류 지점 발견',
          status: '사용자 확인 대기',
          icon: Info,
          iconColor: 'text-[#007AFF]',
          bg: 'bg-[#007AFF]/5',
          description: '목적지 경로상의 라운드어바웃 합류 지점을 발견했습니다. 지금 합류를 시도할까요?',
          actions: [
            { label: '지금 합류', primary: true, onClick: onApprove },
            { label: '조금 더 대기', onClick: onWait }
          ]
        }
      default:
        return null
    }
  }

  const content = getBriefingContent()
  if (!content) return null

  return (
    <motion.div 
      initial={{ x: 450, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 450, opacity: 0 }}
      transition={{ type: 'spring', damping: 25, stiffness: 200 }}
      className="absolute right-[30px] top-[104px] w-[420px] h-[830px] bg-white/90 backdrop-blur-xl rounded-[32px] border border-white/50 shadow-[0px_20px_50px_rgba(0,0,0,0.1)] overflow-hidden z-40 flex flex-col"
    >
      <div className="p-[32px] flex items-center justify-between">
        <div className="flex items-center gap-[12px]">
          <div className="w-[40px] h-[40px] rounded-full bg-[#131417] flex items-center justify-center">
            <CheckCircle2 size={20} className="text-white" />
          </div>
          <span className="text-[20px] font-bold text-[#131417]">상황 브리핑</span>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-[#131417]/5 rounded-full transition-colors">
          <X size={24} className="text-[#131417]" />
        </button>
      </div>

      <div className="px-[32px] py-[20px] flex-1 overflow-y-auto">
        <motion.div 
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className={`rounded-[24px] p-[24px] ${content.bg} mb-[32px]`}
        >
          <div className="flex items-center gap-[12px] mb-[16px]">
            <content.icon size={28} className={content.iconColor} />
            <span className={`text-[18px] font-bold ${content.iconColor}`}>{content.status}</span>
          </div>
          <h3 className="text-[28px] font-bold text-[#131417] mb-[16px] leading-tight">{content.title}</h3>
          <p className="text-[18px] text-[#131417]/70 leading-relaxed">{content.description}</p>
        </motion.div>

        <div className="flex flex-col gap-[16px]">
          {content.actions.map((action, i) => (
            <motion.button
              key={i}
              whileTap={{ scale: 0.98 }}
              onClick={action.onClick}
              className={`w-full py-[20px] rounded-[20px] text-[18px] font-bold transition-all flex items-center justify-center gap-[10px] ${
                action.primary 
                  ? 'bg-[#131417] text-white shadow-lg' 
                  : 'bg-white border border-[#131417]/10 text-[#131417]'
              }`}
            >
              {action.label}
              <ChevronRight size={20} />
            </motion.button>
          ))}
        </div>

        <div className="mt-[40px]">
          <h4 className="text-[16px] font-bold text-[#99a1af] uppercase tracking-wider mb-[20px]">시스템 가이드</h4>
          <div className="flex flex-col gap-[20px]">
             <div className="flex items-start gap-[16px]">
                <div className="w-[32px] h-[32px] rounded-lg bg-[#34C759]/10 flex items-center justify-center shrink-0">
                   <ShieldCheck size={18} className="text-[#34C759]" />
                </div>
                <p className="text-[16px] text-[#131417]/60 leading-snug">ADAS 센서가 주변 차량의 흐름을 0.01초 단위로 분석하여 안전한 합류 궤적을 계산합니다.</p>
             </div>
          </div>
        </div>
      </div>
      
      <div className="p-[32px] border-t border-[#131417]/5 bg-[#131417]/[0.02]">
        <div className="flex items-center justify-between">
           <span className="text-[14px] font-medium text-[#99a1af]">Active Monitoring</span>
           <div className="flex gap-[4px]">
              {[...Array(3)].map((_, i) => (
                <motion.div 
                  key={i}
                  animate={{ opacity: [0.2, 1, 0.2] }}
                  transition={{ repeat: Infinity, duration: 1.5, delay: i * 0.2 }}
                  className="w-[4px] h-[4px] rounded-full bg-[#34C759]"
                />
              ))}
           </div>
        </div>
      </div>
    </motion.div>
  )
}
