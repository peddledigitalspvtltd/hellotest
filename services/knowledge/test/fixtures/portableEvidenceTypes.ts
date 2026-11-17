import {validateContract,type RetrievalRequest,type ContextPacket,type AnswerContract} from '@hellotest/contracts/evidence';
const request:RetrievalRequest={contract_type:'RetrievalRequest',contract_version:'1.0',query:'Which evidence applies?'};
const sameRequest:RetrievalRequest=validateContract(request,'RetrievalRequest');
const query:string=sameRequest.query;
// @ts-expect-error The generated current schema has a closed query class.
const invalidClass:RetrievalRequest={contract_type:'RetrievalRequest',contract_version:'1.0',query:'x',query_class:'EXECUTE_SQL'};
// @ts-expect-error A packet must declare its authorization and limitations.
const incompletePacket:ContextPacket={contract_type:'ContextPacket',contract_version:'1.0',context_packet_id:'packet',evidence:[]};
declare const candidate:unknown;
// @ts-expect-error Validation preserves its input shape; it does not normalize a legacy DTO.
const normalized:AnswerContract=validateContract(candidate,'AnswerContract');
void query;void invalidClass;void incompletePacket;void normalized;
