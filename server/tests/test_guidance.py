import numpy as np
import pytest
from alignment import align_claims
from live import resample_history


def test_weighted_evidence_changes_only_when_required_relation_is_present():
    outline=[{'text':'输入分析','weight':3,'claims':[['采集','输入'],['分析']]},{'text':'反馈改进','weight':2,'claims':[['反馈'],['改进']]},{'text':'使用案例','weight':1,'claims':[['例如'],['课堂']]}]
    text='采集视频，再分析手势。例如在课堂里使用。'
    result=align_claims(outline,text)
    assert result['weighted_coverage']==pytest.approx(4/6)
    assert result['results'][1]['missing_claims']==[['反馈'],['改进']]
    assert align_claims(outline,text+'反馈可以帮助改进。')['weighted_coverage']==1
    assert align_claims(outline,text+'无需反馈，无需改进。')['results'][1]['status']=='需复核'


def test_no_evidence_does_not_hallucinate_completion_or_accept_invalid_weight():
    outline=[{'text':'讲清楚原因','weight':1,'claims':[['因为'],['所以']]}]
    assert align_claims(outline,'天气很好')['weighted_coverage']==0
    assert align_claims(outline,'')['results'][0]['evidence']==''
    outline[0]['weight']=float('nan')
    with pytest.raises(ValueError):align_claims(outline,'文本')


def test_numeric_evidence_matches_complete_number_tokens():
    outline=[{'text':'完成率为7%','weight':1,'claims':[['完成率']]}]
    assert align_claims(outline,'完成率为7%。')['results'][0]['status']=='完整'
    assert align_claims(outline,'完成率为17%。')['results'][0]['status']=='需复核'


def test_live_resampling_uses_only_observed_time_range_and_conservative_visibility():
    rows=[(i/10,np.full((9,3),i/10,dtype=np.float32),np.ones(9,np.float32)) for i in range(22)]
    positions,visibility,times=resample_history(rows)
    assert positions.shape==(40,9,3)
    assert times[-1]==rows[-1][0]
    np.testing.assert_allclose(positions[:,0,0],times,atol=1e-6)
    rows[-1][2][5]=0
    assert resample_history(rows)[1][-1,5]==0
    assert resample_history(rows[:10]) is None
