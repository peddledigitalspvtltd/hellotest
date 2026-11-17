const {policy:specialistPolicy}=require('../specialistPolicy');
const connections=require("../connections");

const {parseObject,readPath,mapValues,inputValue,contextFor}=require("./shared/values");
function validate(node) {
    const { data = {} } = node;
    const kind = "loop";
    const errors = [];
    const check = (task) => {
        try {
            task();
        }
        catch (error) {
            errors.push(error.publicMessage || error.message);
        }
    };
    if (!["customAI", "storyPackets", "workflow"].includes(data.loopAction))
        check(() => mapValues(parseObject(data.transformMapping || "{}", "Field mapping"), {}));
    if (Number(data.retryCount) > 0 && !require("../runtimeEvents").canRetry(kind, data))
        errors.push("Retries are available for AI reviews and HTTP GET/HEAD requests. Set retries to zero for this node.");
    {
        if (typeof data.loopBatchSize === 'boolean' || !Number.isInteger(Number(data.loopBatchSize ?? 1)) || Number(data.loopBatchSize ?? 1) < 1 || Number(data.loopBatchSize ?? 1) > 100)
            errors.push('Batch size must be an integer from 1 to 100.');
        if (data.loopAction === 'storyPackets' && Number(data.loopBatchSize ?? 1) !== 1)
            errors.push('Native Story packets are loaded one at a time. Use a connected workflow for batching.');
        if (!["transform", "customAI", "storyPackets", "workflow"].includes(data.loopAction || "transform"))
            errors.push("Choose field mapping or AI review for each item.");
        if (typeof data.loopMaxIterations === 'boolean' || !Number.isInteger(Number(data.loopMaxIterations)) ||
            Number(data.loopMaxIterations) < 1 ||
            Number(data.loopMaxIterations) > require('../../../shared/workflowNodeKinds.json').limits.max_loop_items)
            errors.push('For each supports 1–100 input items per execution.');
        if (data.loopAction === "customAI" && !String(data.prompt || "").trim())
            errors.push("Describe the AI task for each item.");
    }
    if(data.loopAction==='customAI')try{specialistPolicy(data);}catch(failure){errors.push(failure.publicMessage);}
    return errors;
}
async function execute({ run, node, sources, user, signal, onProgress, review, executeConnectedLoop, }) {
    const data = node.data || {}, kind = "loop";
    if (node.data?.loopAction === "workflow") {if(!executeConnectedLoop) throw connections.fail("Connected loop orchestration is required.");return executeConnectedLoop();}
    const context = contextFor(run, sources, { internal: kind === "artifactTask" });
    {
        const items = readPath(context, data.loopSourceKey || "input.items");
        if (!Array.isArray(items))
            throw connections.fail("For each input must resolve to an array. Check the Items path against the Input panel.");
        const max = Number(data.loopMaxIterations);
        if (items.length > max)
            throw connections.fail(`For each received ${items.length} items; its limit is ${max}. Split the input or increase the limit (maximum ${require('../../../shared/workflowNodeKinds.json').limits.max_loop_items}).`);
        const results = [];
        const mapping = ["customAI", "storyPackets"].includes(data.loopAction) ? null : parseObject(data.transformMapping || "{}", "Field mapping");
        if (data.loopAction === "storyPackets") {
            require("../artifactTasks").checkInput(run);
            const packets = [];
            for (const [index, item] of items.entries()) {
                if (signal?.aborted)
                    throw connections.fail("Iteration cancelled.", 499);
                await onProgress?.({ percent: Math.round(index / Math.max(1, items.length) * 100), current_item: index + 1, total_items: items.length });
                const story = await require("../artifactTasks").loadStory(run, user, item);
                if (packets.some(packet => packet.story_id === story.id))
                    throw connections.fail("The Stories API returned a duplicate Story. Retry against a stable Sprint scope.", 409);
                packets.push({ story_id: story.id, story_revision: require("../artifactTasks").revision(story) });
            }
            await onProgress?.({ percent: 100, current_item: items.length, total_items: items.length });
            return { data: packets, processed: packets.length, for_each: "story", requires_human_review: true };
        }
        const size = Number(data.loopBatchSize || 1), batchCount = Math.ceil(items.length / size);
        const budget = run.loop_budget || (run.loop_budget = { batches: 0, node_executions: 0 });
        const limits = require('../workflowLoopLimits');
        if (budget.batches + batchCount > limits.batches || budget.node_executions + batchCount > limits.node_executions)
            throw connections.fail('This review loop exceeds the shared workflow batch or node-execution budget. Reduce input or increase read-only batch size.', 422);
        const startBudget = { ...budget };
        for (let index = 0; index < batchCount; index++) {
            if (signal?.aborted)
                throw connections.fail('Iteration cancelled.', 499);
            const offset = index * size, batch = items.slice(offset, offset + size), item = size === 1 ? batch[0] : batch;
            budget.batches++;
            budget.node_executions++;
            if (signal?.aborted)
                throw connections.fail("Iteration cancelled.", 499);
            await onProgress?.({
                percent: Math.round((offset / Math.max(1, items.length)) * 100),
                current_item: offset + 1,
                total_items: items.length,
                stages: results.map((_, i) => ({
                    id: String(i),
                    label: `Item ${i + 1}`,
                    status: "completed",
                })),
            });
            const value = data.loopAction === "customAI"
                ? await review({
                    ...run,
                    iteration_input: item,
                    iteration_index: index,
                    iteration_total: batchCount,
                    loop_batch_size: batch.length,
                }, {
                    ...node,
                    data: { ...data, kind: "agent", agentId: "quality-evaluator", customTask: true },
                })
                : {
                    data: mapValues(mapping, { ...context, input: item, item, iteration: { index, number: index + 1, total: batchCount, batch_size: batch.length } }),
                };
            results.push({ index, input_start_index: offset, input_item_count: batch.length, ...value });
        }
        await onProgress?.({
            percent: 100,
            current_item: items.length,
            total_items: items.length,
            stages: results.map((_, i) => ({
                id: String(i),
                label: `Item ${i + 1}`,
                status: "completed",
            })),
        });
        return {
            data: results.map(inputValue),
            items: results,
            processed: items.length,
            total_batches: batchCount,
            execution_usage: { batches: budget.batches - startBudget.batches, node_executions: budget.node_executions - startBudget.node_executions },
            ...(results.some((result) => result.readiness && result.readiness.status !== "ready_for_review")
                ? { readiness: { status: "limited" } }
                : {}),
        };
    }
    throw connections.fail("This node does not have an execution adapter.");
}
module.exports=require("./definition")("loop",{acceptsLoopPolicy:true,timeoutMaxMs:data=>data.loopAction==='workflow'?3600000:70000,preflight:{model:context=>context.node.data.loopAction==='customAI'?require('./shared/modelPreflight')(context):undefined},preflightFailure:(_phase,failure)=>failure.publicMessage||"Check this agent's version and model connection.",validate,execute,connectedLoop:data=>data.loopAction==='workflow'});
