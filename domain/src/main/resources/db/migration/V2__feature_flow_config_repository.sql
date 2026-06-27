alter table if exists FeatureFlowConfiguration drop column if exists repository_id;
alter table if exists FeatureFlowConfiguration add column if not exists project_id varchar(255);
alter table if exists FeatureFlowConfiguration add constraint FK_ffc_project foreign key (project_id) references Project;
