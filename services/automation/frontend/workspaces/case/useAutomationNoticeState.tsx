import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { AutomationCaseScope } from './useAutomationCaseScope';
import type { AutomationCaseSelection } from './useAutomationCaseSelection';
export function useAutomationNoticeState(_scope:AutomationCaseScope,_selection:AutomationCaseSelection){
 const location=useLocation(),notice=location.state?.automationNotice;
 const [message,setMessage]=useState(()=>typeof notice?.message==='string'?notice.message:'');
 const [messageTone,setMessageTone]=useState<'success'|'error'|'info'>(()=>notice?.tone==='error'?'error':notice?.tone==='info'?'info':'success');
 return {message,setMessage,messageTone,setMessageTone};
}
export type AutomationNoticeState=ReturnType<typeof useAutomationNoticeState>;
