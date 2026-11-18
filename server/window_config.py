"""Select only timing combinations actually supported by a loaded checkpoint."""
import json
from pathlib import Path
from motion import ROOT, FPS, HISTORY, HORIZON, Predictor

FLEXIBLE_RUN=ROOT/'runs/long-fine-v4'
EXTENDED_RUN=ROOT/'runs/ten-seconds-v5'


class WindowRegistry:
    def __init__(self,legacy):
        self.legacy=legacy;self.flexible=None;self.report=None
        self.extended=None;self.extended_report=None
        if (FLEXIBLE_RUN/'forecast.pt').exists() and (FLEXIBLE_RUN/'evaluation.json').exists():
            self.flexible=Predictor(FLEXIBLE_RUN/'forecast.pt')
            self.report=json.loads((FLEXIBLE_RUN/'evaluation.json').read_text('utf-8'))
        if (EXTENDED_RUN/'forecast.pt').exists() and (EXTENDED_RUN/'evaluation.json').exists():
            self.extended=Predictor(EXTENDED_RUN/'forecast.pt')
            self.extended_report=json.loads((EXTENDED_RUN/'evaluation.json').read_text('utf-8'))

    def resolve(self,payload):
        profile=payload.get('model_profile','legacy')
        if profile not in {'legacy','flexible','extended'}:raise ValueError('未知模型版本。')
        model={'legacy':self.legacy,'flexible':self.flexible,'extended':self.extended}[profile]
        if model is None:raise ValueError('可调时间窗模型尚未就绪。')
        default_h=model.metadata.get('default_history_frames',HISTORY)
        default_f=model.metadata.get('default_horizon_frames',HORIZON)
        h=float(payload.get('history_seconds',default_h/FPS))*FPS
        f=float(payload.get('horizon_seconds',default_f/FPS))*FPS
        if h not in model.history_options or f not in model.horizon_options:
            raise ValueError('请选择已训练支持的观察与预测时长。')
        return model,int(h),int(f),profile

    def options(self):
        if self.flexible is None:return dict(available=False)
        metadata=self.flexible.metadata
        return dict(available=True,model_profile='flexible',histories=[h/FPS for h in self.flexible.history_options],horizons=[f/FPS for f in self.flexible.horizon_options],
                    default_history_seconds=metadata['default_history_frames']/FPS,default_horizon_seconds=metadata['default_horizon_frames']/FPS,
                    note='观察时长在验证集选择；2秒预测为练习体验设置，3秒为探索范围，并非已验证的最佳反应时间。',
                    model_name='多尺度时序预测 v4',pose_backend=metadata.get('pose_backend'),
                    extended=dict(available=self.extended is not None,histories=[h/FPS for h in self.extended.history_options] if self.extended else [],horizons=[f/FPS for f in self.extended.horizon_options] if self.extended else [],model_name='10秒直接预测 v5 · 探索'))

    def selected_report(self,h,f,profile):
        if profile=='legacy':return None
        report=self.extended_report if profile=='extended' else self.report
        metrics=report['profiles'][f'{h}:{f}']
        metadata=dict(report['metadata'],history_seconds=h/FPS,horizon_seconds=f/FPS)
        return dict(metadata=metadata,**metrics,model_sha256=report['model_sha256'])
