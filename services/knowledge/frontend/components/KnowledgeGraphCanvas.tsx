import { memo, useEffect, useMemo } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, useStore, type Node, type NodeProps } from '@xyflow/react';
import { IconBook2, IconBox, IconBug, IconClock, IconFileText, IconFocus2, IconGitBranch, IconLayersLinked, IconMessageCircle, IconPlayerPlay, IconRoute, IconShieldCheck, IconStack2 } from '@tabler/icons-react';
import { graphKindLabel, graphLabel, graphNodeTitle, layoutGraph, type GraphViewEdge, type GraphViewNode } from '../lib/knowledgeGraphView';
import '@xyflow/react/dist/style.css';
type Selection = {kind:'node'|'edge';id:string} | null;
type Props = {nodes:GraphViewNode[];edges:GraphViewEdge[];selection:Selection;onSelect:(value:Selection)=>void;mode:'knowledge'|'context'};
type CardData = Record<string,unknown> & {record:GraphViewNode};
const icons: Record<string,typeof IconFileText> = {requirement:IconBook2,test_case:IconBox,execution:IconPlayerPlay,bug:IconBug,task:IconRoute,context_packet:IconLayersLinked,decision_event:IconGitBranch,event:IconClock,source_evidence:IconFileText,session:IconMessageCircle,policy_check:IconShieldCheck};
const GraphCard = memo(function GraphCard({data,selected}:NodeProps<Node<CardData>>) {
  const node=data.record,Icon=icons[node.kind]||IconFileText,status=node.source_status||node.evidence_state||node.metadata?.source_status;
  const statusLabel=typeof status==='string'?({CURRENT:'Current',STALE:'Historical',EXPIRED:'Expired',NOT_YET_VALID:'Not yet valid',MIXED:'Mixed revisions',UNKNOWN:'Unknown validity',RECORDED_SNAPSHOT:'Snapshot'} as Record<string,string>)[status]:undefined;
  return <div className={`knowledge-map-card${selected?' is-selected':''}`} data-kind={node.kind}>
    <Handle type="target" position={Position.Left} isConnectable={false}/>
    <div className="knowledge-map-card-head"><span className="knowledge-map-kind-icon"><Icon size={17} stroke={1.7}/></span><span>{graphKindLabel(node.kind)}</span>{statusLabel?<span className="knowledge-map-card-state" data-state={status}>{statusLabel}</span>:null}</div>
    <strong title={graphNodeTitle(node)}>{graphNodeTitle(node)}</strong><small title={node.ref_id||node.source_id||node.id}>{node.ref_id||node.source_id||node.id}</small>
    <Handle type="source" position={Position.Right} isConnectable={false}/>
  </div>;
});
const nodeTypes={knowledgeRecord:GraphCard};
function InnerCanvas({nodes,edges,selection,onSelect,mode}:Props) {
  const flow=useReactFlow();
  const initialized=useNodesInitialized(),width=useStore(state=>state.width),height=useStore(state=>state.height);
  const positions=useMemo(()=>new Map(layoutGraph(nodes,edges).map(item=>[item.id,item.position])),[nodes,edges]);
  const displayedNodes=useMemo(()=>nodes.map(node=>({id:node.id,type:'knowledgeRecord',position:positions.get(node.id)!,data:{record:node},selected:selection?.kind==='node'&&selection.id===node.id,ariaLabel:`${graphKindLabel(node.kind)}: ${node.title}`,draggable:false})),[nodes,positions,selection]);
  const byId=useMemo(()=>new Map(nodes.map(node=>[node.id,node])),[nodes]);
  const displayedEdges=useMemo(()=>edges.map(edge=>({id:edge.id,source:edge.source,target:edge.target,label:graphLabel(edge.type),selected:selection?.kind==='edge'&&selection.id===edge.id,
    ariaLabel:`${byId.get(edge.source)?.title||edge.source} ${graphLabel(edge.type)} ${byId.get(edge.target)?.title||edge.target}`,
    markerEnd:{type:MarkerType.ArrowClosed,width:16,height:16,color:selection?.id===edge.id?'#087f89':'#94a8b3'},
    style:{stroke:selection?.id===edge.id?'#087f89':'#9dafb9',strokeWidth:selection?.id===edge.id?2:1.4,strokeDasharray:edge.provenance_type==='HUMAN_VERIFIED'?'5 4':undefined},
    labelStyle:{fill:'var(--text-secondary, #526473)',fontSize:11,fontWeight:500},labelBgPadding:[7,4] as [number,number],labelBgBorderRadius:5,labelBgStyle:{fill:'var(--surface-color, #fff)',fillOpacity:1},interactionWidth:24
  })),[edges,selection,byId]);
  useEffect(()=>{if(initialized&&width>0&&height>0)void flow.fitView({padding:.22,minZoom:.35,maxZoom:1,duration:0});},[initialized,width,height,nodes,edges,flow]);
  // Keyboard selection arrives as changes; companion deselections must not clear the newly selected record.
  return <div className="knowledge-map-canvas" role="region" aria-label={mode==='knowledge'?'Knowledge graph map':'Context graph map'} onKeyDownCapture={event=>{if(event.key===' '&&(event.target as Element).closest('.react-flow__node, .react-flow__edge'))event.preventDefault();}}>
    <ReactFlow nodes={displayedNodes} edges={displayedEdges} nodeTypes={nodeTypes} fitView fitViewOptions={{padding:.22,minZoom:.35,maxZoom:1}} minZoom={.15} maxZoom={1.75} nodesDraggable={false} nodesConnectable={false} edgesFocusable nodesFocusable deleteKeyCode={null} zoomOnDoubleClick={false}
      onNodesChange={changes=>{for(const change of changes)if(change.type==='select'&&change.selected)onSelect({kind:'node',id:change.id});}}
      onEdgesChange={changes=>{for(const change of changes)if(change.type==='select'&&change.selected)onSelect({kind:'edge',id:change.id});}}
      onNodeClick={(_,node)=>onSelect({kind:'node',id:node.id})} onEdgeClick={(_,edge)=>onSelect({kind:'edge',id:edge.id})} onPaneClick={()=>onSelect(null)}>
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--border-color, #dce5e9)"/>
      <Controls showInteractive={false}/>
    </ReactFlow>
    <div className="knowledge-map-caption"><IconStack2 size={14}/><span>{nodes.length} nodes · {edges.length} directed links</span></div>
    <button type="button" className="knowledge-map-fit" onClick={()=>void flow.fitView({padding:.22,minZoom:.35,maxZoom:1,duration:0})}><IconFocus2 size={16}/>Fit graph</button>
  </div>;
}
export function KnowledgeGraphCanvas(props:Props) { return <ReactFlowProvider><InnerCanvas {...props}/></ReactFlowProvider>; }
