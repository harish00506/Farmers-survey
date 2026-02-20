#!/usr/bin/env node

/**
 * Integration tests for transition validation and cycle detection
 * Runs against a local backend at http://localhost:3000
 */

import axios from 'axios';

const API = 'http://localhost:3000/api/survey';

const fail = (msg) => {
    console.error('\n✗', msg);
    process.exit(1);
};

const ok = (msg) => console.log('✓', msg);

const cleanup = async (ids = []) => {
    for (const id of ids) {
        try {
            await axios.delete(`${API}/questions/${id}`);
        } catch (err) {
            // ignore
        }
    }
};

const run = async () => {
    const ts = Date.now();
    const testIds = [`TST_A_${ts}`, `TST_B_${ts}`, `TST_C_${ts}`];
    await cleanup(testIds);

    try {
        // 1) create three test questions (use unique ids per run)
        await axios.post(`${API}/questions`, { id: testIds[0], sequence: 200, text: 'Test A', type: 'MCQ', options: ['opt1', 'opt2'] });
        await axios.post(`${API}/questions`, { id: testIds[1], sequence: 201, text: 'Test B', type: 'MCQ', options: ['opt1'] });
        await axios.post(`${API}/questions`, { id: testIds[2], sequence: 202, text: 'Test C', type: 'MCQ', options: ['opt1'] });
        ok('created test questions');

        // 2) invalid option index should be rejected
        try {
            await axios.put(`${API}/questions/${testIds[0]}`, { nextIfOption: { '100': testIds[1] } });
            fail('server accepted out-of-range option index');
        } catch (err) {
            const msg = err?.response?.data?.error || err.message;
            if (!/Invalid option index/.test(msg)) fail('unexpected error for invalid option index: ' + msg);
            ok('rejected out-of-range option index');
        }

        // 3) invalid target id should be rejected
        try {
            await axios.put(`${API}/questions/${testIds[0]}`, { nextIfOption: { '0': 'DOES_NOT_EXIST' } });
            fail('server accepted non-existent target id');
        } catch (err) {
            const msg = err?.response?.data?.error || err.message;
            if (!/Invalid target question id/.test(msg)) fail('unexpected error for invalid target id: ' + msg);
            ok('rejected non-existent target id');
        }

        // 4) ensure any stale conditional mapping removed, then set a valid default next and verify
        await axios.put(`${API}/questions/${testIds[0]}`, { nextIfOption: {} }).catch(() => { }); // best-effort clear
        await axios.put(`${API}/questions/${testIds[0]}`, { nextId: testIds[1] });
        const resA = await axios.get(`${API}/questions/${testIds[0]}`);
        if (!resA.data.question || resA.data.question.nextId !== testIds[1]) fail('default next not saved');
        ok('saved valid default next');

        // 5) attempt to create a cycle: TST_A -> TST_B (exists), now set TST_B -> TST_A should be rejected
        try {
            await axios.put(`${API}/questions/${testIds[1]}`, { nextId: testIds[0] });
            fail('server allowed a cycle (TST_B -> TST_A)');
        } catch (err) {
            const msg = err?.response?.data?.error || err.message;
            if (!/Cycle detected/.test(msg)) fail('unexpected error when creating cycle: ' + msg);
            ok('cycle was detected and rejected');
        }

        // 6) valid conditional mapping: TST_A option 0 -> TST_C
        await axios.put(`${API}/questions/${testIds[0]}`, { nextIfOption: { '0': testIds[2] } });
        const after = await axios.get(`${API}/questions/${testIds[0]}`);
        const mapping = after.data.question.nextIfOption || {};
        if (mapping['0'] !== testIds[2]) fail('conditional mapping not persisted');
        ok('saved conditional mapping successfully');

        console.log('\nAll transition tests passed');
    } catch (err) {
        console.error('\nTest error:', err.message || err);
        if (err.response && err.response.data) console.error('Response body:', JSON.stringify(err.response.data));
        process.exit(1);
    } finally {
        await cleanup(testIds);
        process.exit(0);
    }
};

run();
